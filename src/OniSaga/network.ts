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
const PAGE_RETRY_LIMIT = 3;
// Backoff when the page API 429s without a Retry-After.
const RATE_LIMIT_FALLBACK_MS = 2500;
// Ceiling on how long a 429 can park the pipeline, so a pathological
// Retry-After can't freeze the reader (onisaga's real penalty is ~60s).
const MAX_COOLDOWN_MS = 90_000;

// After a 429, hold at least this spacing (the proven-safe rate) until the
// strike decays, so an aggressive Image Requests Limit setting can't keep
// re-tripping the penalty. Self-tuning, adapted from the mangabox/kakarot
// adaptive-pacing pattern to onisaga's fixed-penalty model.
const STRIKE_FLOOR_SECONDS = 2;
const STRIKE_DECAY_MS = 120_000;

// Proactively re-home the reader session after this many pages. The "Session
// page limit" 429 was observed at ~page 84, so refreshing well before it (like
// MangaDex refreshes its token before `exp`) keeps a long chapter from hitting
// the wall at all. Normal-length chapters never reach it, so they pay nothing.
const SESSION_PAGE_BUDGET = 50;

// Shared page-API throttle state. A 429 carries Retry-After (~60s) and does
// NOT decrement the advertised 300/min counter, so it's a separate
// burst/penalty limit: once tripped, every page request is rejected for the
// whole window. `until` parks all page requests through the penalty so the
// queued prefetch can't hammer it open; `strikeUntil` then holds the safe
// floor for a while so we don't immediately re-trip. Epoch ms.
const pageCooldown = { until: 0, strikeUntil: 0 };

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

// Lower-cased `error` string from a page-API JSON error body ({"error": "..."}),
// used to tell the two 429 kinds apart. "" when the body isn't parseable.
function parseErrorMessage(data: ArrayBuffer): string {
  try {
    const dto = JSON.parse(Application.arrayBufferToUTF8String(data)) as { error?: string };
    return (dto.error ?? "").toLowerCase();
  } catch {
    return "";
  }
}

export class OniSagaInterceptor extends PaperbackInterceptor {
  // Per-chapter reader sessions (chapterId -> token + reader-page referer) set
  // by getChapterDetails; the page API wants both, like the site's own reader.
  // `pagesServed` counts pages resolved on the current session key, so we can
  // re-home it before the server's per-session page quota trips.
  private readerSessions = new Map<
    string,
    {
      token: string;
      referer: string;
      pagesServed: number;
      refreshedAt?: number;
      refreshOk?: boolean;
    }
  >();

  // Coalesce rapid re-mints: a genuinely dead session 403s every prefetched
  // page, and each page's sequential retries would otherwise each reload the
  // reader page. Reusing a very recent refresh outcome bounds those reloads to
  // one per window instead of a burst that itself looks abusive.
  private static readonly REFRESH_MIN_INTERVAL_MS = 8000;

  // De-duped reader-session refreshes: a prefetch burst can 429 many pages at
  // once, so the first refresh re-fetches the reader page (minting a token with
  // a fresh session key = fresh page budget) and the rest await that one result.
  private refreshInFlight = new Map<string, Promise<boolean>>();

  setReaderToken(chapterId: string, token: string, referer: string): void {
    this.readerSessions.set(chapterId, { token, referer, pagesServed: 0 });
  }

  // Mint a brand-new reader session by reloading the reader page. Adopting the
  // rotating `x-reader-token-next` keeps the same session key, so its page
  // budget never resets; a full reader-page load is what the site's own reader
  // does to carry a long chapter past the "Session page limit".
  private async refreshSession(cid: string): Promise<boolean> {
    const existing = this.refreshInFlight.get(cid);
    if (existing) return existing;

    const session = this.readerSessions.get(cid);
    if (!session) return false;

    // A reload moments ago won't yield a better token — reuse its outcome so a
    // dead session can't trigger a reader-page reload per 403.
    if (
      session.refreshedAt !== undefined &&
      Date.now() - session.refreshedAt < OniSagaInterceptor.REFRESH_MIN_INTERVAL_MS
    ) {
      return session.refreshOk ?? false;
    }

    const task = (async () => {
      const [, page] = await Application.scheduleRequest({ url: session.referer, method: "GET" });
      const token = extractReaderToken(Application.arrayBufferToUTF8String(page));
      session.refreshedAt = Date.now();
      session.refreshOk = Boolean(token);
      if (!token) return false;
      session.token = token;
      session.pagesServed = 0;
      return true;
    })().catch((error: unknown) => {
      // A Cloudflare challenge on the reader-page reload must surface so the
      // app opens the bypass; any other failure just means "couldn't refresh".
      if (error instanceof CloudflareError) throw error;
      // Stamp the failure too, so a transient error doesn't invite an immediate
      // reload storm; the next window is free to try again.
      session.refreshedAt = Date.now();
      session.refreshOk = false;
      return false;
    });

    this.refreshInFlight.set(cid, task);
    try {
      return await task;
    } finally {
      this.refreshInFlight.delete(cid);
    }
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
        // Mirror the site reader's fetch exactly (verified against a live
        // devtools capture): Accept */* (fetch default — not application/json),
        // the full sec-fetch trio, and NO Origin header (browsers omit it on
        // same-origin GETs, cors mode notwithstanding).
        headers["x-reader-token"] = session.token;
        headers.accept = "*/*";
        headers["sec-fetch-dest"] = "empty";
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

    // Browse/search/details endpoints can also 429 — onisaga rate-limits deep
    // search pagination (the heaviest, multi-MB responses). Unlike the reader
    // page API (handled below with its own shared cooldown), these have no
    // pacing beyond the global limiter, so a rate-limited page would otherwise
    // surface as an empty list. Honour Retry-After and retry once, bounded by
    // the same header guard, preserving the original method and body (a Livewire
    // update is a POST). The reader page API keeps its dedicated path.
    if (!PAGE_API_REGEX.test(request.url) && response.status === 429) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        await Application.sleep(
          Math.min(getRetryDelayMs(response.headers), MAX_COOLDOWN_MS) / 1000,
        );
        const [, buffer] = await Application.scheduleRequest({
          ...request,
          headers: { ...request.headers, [PAGE_RETRY_HEADER]: String(attempt + 1) },
        });
        return buffer;
      }
    }

    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    const session = cid ? this.readerSessions.get(cid) : undefined;

    // The reader can rotate the chapter token; adopt the replacement so later
    // page requests stay authorized (the site's own reader does the same).
    const nextToken = getHeaderValue(response.headers, "x-reader-token-next");
    if (session && nextToken) session.token = nextToken;

    // Reader tokens expire after ~10 minutes, and the app requests pages long
    // after the chapter was opened. On an auth failure, mint a fresh session and
    // retry; the retry re-enters this interceptor with the new token, bounded by
    // a retry-count header.
    if (session && cid && (response.status === 403 || response.status === 401)) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT && (await this.refreshSession(cid))) {
        const [, buffer] = await Application.scheduleRequest({
          url: request.url,
          method: "GET",
          headers: { ...request.headers, [PAGE_RETRY_HEADER]: String(attempt + 1) },
        });
        return buffer;
      }
    }

    // The page API returns two different 429s, told apart by the error body:
    //   "Session page limit exceeded" — a per-session page quota (retry-after ~30,
    //       ratelimit-remaining untouched). Rotating the token keeps the same
    //       session key, so only a fresh session resets it → re-mint and retry.
    //   "Rate limit exceeded" — request-frequency penalty (retry-after ~60,
    //       ratelimit-remaining decrementing). A fresh session does NOT help and
    //       just burns a request, so park the whole pipeline for the Retry-After
    //       window and hold the safe floor instead. Anything unrecognized is
    //       treated as the rate case (the safer default). The tiny JSON error
    //       body would otherwise render as a broken page.
    if (PAGE_API_REGEX.test(request.url) && response.status === 429) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        const isPageLimit = parseErrorMessage(data).includes("page limit");
        const refreshed =
          isPageLimit && session && cid && attempt === 0 ? await this.refreshSession(cid) : false;
        if (!refreshed) {
          const backoffMs = Math.min(getRetryDelayMs(response.headers), MAX_COOLDOWN_MS);
          const now = Date.now();
          pageCooldown.until = Math.max(pageCooldown.until, now + backoffMs);
          // Hold the safe floor for a while so we don't re-trip right after.
          pageCooldown.strikeUntil = now + STRIKE_DECAY_MS;
        }
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
          // Count this page against the session's budget and re-home it a few
          // pages early, so a long chapter never reaches the "Session page
          // limit" 429. The refresh is de-duped and fire-and-forget: the
          // current token is still valid, so it keeps serving until the fresh
          // one is ready. Reset first so it triggers once, not every page after.
          // Skip it while a rate-limit strike is active — the reader page is an
          // extra request the frequency limiter would count against us.
          if (
            session &&
            cid &&
            ++session.pagesServed >= SESSION_PAGE_BUDGET &&
            Date.now() >= pageCooldown.strikeUntil
          ) {
            session.pagesServed = 0;
            // Swallow rejections here: this refresh is opportunistic, and a
            // Cloudflare challenge will surface on the next real page request.
            void this.refreshSession(cid).catch(() => undefined);
          }
          const [, imageBuffer] = await Application.scheduleRequest({
            url: dto.url,
            method: "GET",
            headers: { referer: session?.referer ?? `${DOMAIN}/` },
          });
          return imageBuffer;
        }
        // A 200 with no url is a JSON error payload (e.g. an expired token
        // reported with a `message`), which would otherwise render as broken
        // image bytes. Mint a fresh session and retry, like the 401/403 path.
        if (session && cid && dto.message) {
          const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
          if (attempt < PAGE_RETRY_LIMIT && (await this.refreshSession(cid))) {
            const [, buffer] = await Application.scheduleRequest({
              url: request.url,
              method: "GET",
              headers: { ...request.headers, [PAGE_RETRY_HEADER]: String(attempt + 1) },
            });
            return buffer;
          }
        }
      } catch (error) {
        // A Cloudflare challenge on the signed-image fetch must reach the app so
        // it opens the bypass, not be flattened into a broken page.
        if (error instanceof CloudflareError) throw error;
        // Any other failure: fall through and return the original body; the
        // reader shows a broken page rather than hanging the whole chapter.
      }
    }

    return data;
  }
}

// Reader page-API pacing. The site rejects a fast burst with a 60s penalty
// (the hidden limit above, ~1 req/s sustained), so page requests are
// serialized and spaced at the user's Image Requests Limit — the same steady,
// one-at-a-time cadence the site's own reader uses. A small initial burst
// keeps the first screen snappy while staying well under the penalty
// threshold. Everything except the page API passes through untouched
// (Webtoon-style per-endpoint scoping).
// A short opener, mirroring the site's own reader — it fetches the current page
// plus the next two before settling into a steady lookahead. Three quick pages
// open the first screen without front-loading the frequency limiter.
const BURST_CAPACITY = 3;
const BURST_SPACING_SECONDS = 0.3;

// Sustainable floor between page requests, evenly enforced (see pace). onisaga's
// hidden frequency limiter trips a "Rate limit exceeded" 429 near ~60/min — but
// as a *short-window* limiter, not a 60s average: front-loading ~50 requests in
// ~35s (a big burst plus a sub-second per-page delay) trips it even though the
// minute average is under 60. So the fix is even spacing, not a rolling average.
// ~1.2s/request (~50/min) holds a clear margin under the threshold — even the
// 3-page opener plus the first minute of steady requests stays near ~52, not
// grazing 60 — matching the site's own ~1 req/s sustained cadence. The user's
// Image Requests Limit can only make reading *slower* than this; it can't
// undercut the floor and re-trip the limiter.
const SUSTAINED_FLOOR_SECONDS = 1.2;

export class OniSagaPageRateLimiter extends PaperbackInterceptor {
  private burst = BURST_CAPACITY;
  private lastChapterId = "";
  private chain: Promise<unknown> = Promise.resolve();
  // Fire time of the last page request, for even inter-request spacing.
  private lastRequestAt = 0;

  override async interceptRequest(request: Request): Promise<Request> {
    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    if (!cid) return request;
    // A fresh chapter gets a fresh burst so its first screen opens fast too —
    // chapters are minutes apart in practice, so this stays under the ceiling.
    if (cid !== this.lastChapterId) {
      this.lastChapterId = cid;
      if (Date.now() >= pageCooldown.strikeUntil) this.burst = BURST_CAPACITY;
    }
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
    // Park behind an open penalty cooldown before doing anything else.
    const cooldownMs = pageCooldown.until - Date.now();
    if (cooldownMs > 0) {
      await Application.sleep(cooldownMs / 1000);
      this.burst = 0; // after a penalty, hold the steady rate — don't burst again
    }

    // Minimum interval since the previous page request. The opener fires a few
    // quick pages; after that every request is evenly spaced at the user's
    // setting, floored to the sustainable rate (raised further while a strike is
    // cooling). Even spacing — not a rolling average — is what keeps the
    // short-window frequency limiter from tripping, since it never lets a burst
    // of requests stack up inside the limiter's window.
    let intervalSeconds: number;
    if (this.burst > 0) {
      this.burst -= 1;
      intervalSeconds = BURST_SPACING_SECONDS;
    } else {
      intervalSeconds = Math.max(getPageDelaySeconds(), SUSTAINED_FLOOR_SECONDS);
      if (Date.now() < pageCooldown.strikeUntil) {
        intervalSeconds = Math.max(intervalSeconds, STRIKE_FLOOR_SECONDS);
      }
    }

    const waitMs = this.lastRequestAt + intervalSeconds * 1000 - Date.now();
    if (waitMs > 0) await Application.sleep(waitMs / 1000);
    this.lastRequestAt = Date.now();
  }
}
