/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN, type PageApiResponse } from "./models";
import { extractReaderToken } from "./parsers";
import { getPageDelaySeconds } from "./utils/helpers";

// Matches a reader page-API url and captures the chapter id, e.g.
// https://onisaga.com/api/chapter/3718181/page/0
const PAGE_API_REGEX = /\/api\/chapter\/([^/]+)\/page\/\d+/;

// Bounds re-entrant page retries (the retry re-runs both interceptors).
const PAGE_RETRY_HEADER = "x-pb-page-retry";
const PAGE_RETRY_LIMIT = 2;
// Backoff when the page API 429s without a Retry-After.
const RATE_LIMIT_FALLBACK_MS = 2500;

// Response headers can arrive in any casing; read them case-insensitively.
function getHeaderValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

// Delay before retrying a rate-limited request, honouring Retry-After.
function getRetryDelayMs(headers: Record<string, string> | undefined): number {
  const retryAfter = Number(getHeaderValue(headers, "retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_FALLBACK_MS;
}

export class OniSagaInterceptor extends PaperbackInterceptor {
  // Per-chapter reader sessions (chapterId -> token + reader-page referer) set
  // by getChapterDetails; the page API wants both, like the site's own reader.
  private readerSessions = new Map<string, { token: string; referer: string }>();

  setReaderToken(chapterId: string, token: string, referer: string): void {
    this.readerSessions.set(chapterId, { token, referer });
  }

  override async interceptRequest(request: Request): Promise<Request> {
    // Keep a caller-provided Referer/Origin (Livewire calls send page-specific
    // ones); normalize to lower-case so the map never carries both casings.
    // Origin is only sent when a caller set it (browsers omit it on plain GETs).
    const headers: Record<string, string> = { ...request.headers };
    const referer = headers.referer ?? headers.Referer ?? `${DOMAIN}/`;
    const origin = headers.origin ?? headers.Origin;
    delete headers.Referer;
    delete headers.Origin;
    headers.referer = referer;
    if (origin) headers.origin = origin;
    headers["user-agent"] = await Application.getDefaultUserAgent();

    // A reader page-API request carries the chapter's signed token and the
    // reader page as referer, matching the site's own reader fetch.
    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    if (cid) {
      const session = this.readerSessions.get(cid);
      if (session) {
        headers["x-reader-token"] = session.token;
        headers.accept = "application/json";
        headers["sec-fetch-mode"] = "cors";
        headers["sec-fetch-site"] = "same-origin";
        headers.referer = session.referer;
      }
    }

    return { ...request, headers };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = getHeaderValue(response.headers, "cf-mitigated");
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }

    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    const session = cid ? this.readerSessions.get(cid) : undefined;

    // The reader can rotate the chapter token; adopt the replacement so later
    // page requests stay authorized (the site's own reader does the same).
    const nextToken = getHeaderValue(response.headers, "x-reader-token-next");
    if (session && nextToken) session.token = nextToken;

    // Reader tokens expire after ~10 minutes, and the app requests pages long
    // after the chapter was opened. On an auth failure, re-mint a token from
    // the reader page and retry; the retry re-enters this interceptor with the
    // fresh token, bounded by a retry-count header.
    if (session && (response.status === 403 || response.status === 401)) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        const [, page] = await Application.scheduleRequest({
          url: session.referer,
          method: "GET",
        });
        const token = extractReaderToken(Application.arrayBufferToUTF8String(page));
        if (token) {
          session.token = token;
          const [, buffer] = await Application.scheduleRequest({
            url: request.url,
            method: "GET",
            headers: { ...request.headers, [PAGE_RETRY_HEADER]: String(attempt + 1) },
          });
          return buffer;
        }
      }
    }

    // A 429 body is a tiny JSON error, not an image; left alone it would render
    // as a broken page. Honour Retry-After (falling back to a fixed gap) and
    // retry once or twice, bounded by the same retry-count header.
    if (PAGE_API_REGEX.test(request.url) && response.status === 429) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        await Application.sleep(getRetryDelayMs(response.headers) / 1000);
        const [, buffer] = await Application.scheduleRequest({
          url: request.url,
          method: "GET",
          headers: { ...request.headers, [PAGE_RETRY_HEADER]: String(attempt + 1) },
        });
        return buffer;
      }
    }

    // Lazy page resolution: a page-API url returns JSON pointing at the real
    // signed image; fetch that and return its bytes. The image path (/_img/...)
    // differs, so this sub-request doesn't re-enter this branch.
    if (PAGE_API_REGEX.test(request.url) && response.status === 200) {
      try {
        const dto = JSON.parse(Application.arrayBufferToUTF8String(data)) as PageApiResponse;
        if (dto.url) {
          const [, imageBuffer] = await Application.scheduleRequest({
            url: dto.url,
            method: "GET",
            headers: { referer: session?.referer ?? `${DOMAIN}/` },
          });
          return imageBuffer;
        }
      } catch {
        // Fall through and return the original body; the reader shows a broken
        // page rather than hanging the whole chapter.
      }
    }

    return data;
  }
}

// Reader page-API pacing. The site's throttle behaves like a token bucket: it
// tolerates a fast burst (~80 requests observed before 429s start) but clamps
// sustained fast cadences. Spend a conservative burst allowance quickly so the
// first screenfuls appear at once, then fall back to the user's Image Requests
// Limit; the allowance refills at that same sustained rate while reading.
// Everything except the page API passes through untouched (Webtoon-style
// per-endpoint scoping), and requests are serialized so the reader's parallel
// prefetch window drains in order instead of bursting.
const BURST_CAPACITY = 40;
const BURST_SPACING_SECONDS = 0.25;

export class OniSagaPageRateLimiter extends PaperbackInterceptor {
  private tokens = BURST_CAPACITY;
  private lastRefill = 0;
  private chain: Promise<unknown> = Promise.resolve();

  override async interceptRequest(request: Request): Promise<Request> {
    if (!PAGE_API_REGEX.test(request.url)) return request;
    const wait = this.chain.then(() => this.pace());
    // Keep the chain alive even if one wait rejects.
    this.chain = wait.catch(() => undefined);
    await wait;
    return request;
  }

  override async interceptResponse(
    _request: Request,
    _response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    return data;
  }

  private async pace(): Promise<void> {
    // Read the setting per request so a change applies immediately.
    const sustainedMs = getPageDelaySeconds() * 1000;
    const now = Date.now();
    if (this.lastRefill === 0 || this.tokens >= BURST_CAPACITY) {
      this.lastRefill = now;
    } else {
      const earned = Math.floor((now - this.lastRefill) / sustainedMs);
      if (earned > 0) {
        this.tokens = Math.min(BURST_CAPACITY, this.tokens + earned);
        this.lastRefill =
          this.tokens >= BURST_CAPACITY ? now : this.lastRefill + earned * sustainedMs;
      }
    }

    if (this.tokens > 0) {
      this.tokens -= 1;
      await Application.sleep(BURST_SPACING_SECONDS);
      return;
    }

    // Allowance spent: wait out the remainder of the current accrual interval
    // and consume the token it grants, so the sustained rate holds exactly.
    const waitMs = sustainedMs - (Date.now() - this.lastRefill);
    if (waitMs > 0) await Application.sleep(waitMs / 1000);
    this.lastRefill += sustainedMs;
  }
}
