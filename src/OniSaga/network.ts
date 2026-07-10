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

// Matches a reader page-API url and captures the chapter id and page order,
// e.g. https://onisaga.com/api/chapter/3718181/page/0 -> ["3718181", "0"].
const PAGE_API_REGEX = /\/api\/chapter\/([^/]+)\/page\/(\d+)/;

// Bounds re-entrant page retries (the retry re-runs both interceptors).
const PAGE_RETRY_HEADER = "x-pb-page-retry";
const PAGE_RETRY_LIMIT = 3;
// Backoff when a request 429s without a Retry-After.
const RATE_LIMIT_FALLBACK_MS = 2500;
// Ceiling on how long a non-reader 429 (browse/search) can park a retry, so a
// pathological Retry-After can't freeze a listing fetch.
const MAX_COOLDOWN_MS = 90_000;

// Cap on the wait before retrying a page-API 429. The site's own reader ignores
// the advertised ~60s Retry-After and retries after at most ~6s (its
// resolvePageUrl waits Math.min(6000, …)): the frequency limiter is a rolling
// window that refills in a few seconds, so a short wait clears it — and a fresh
// token would not. Matching that turns a 60s reader stall into ~6s.
const RATE_LIMIT_MAX_WAIT_MS = 6000;

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

// A signed CDN URL is valid ~10 min; reuse a cached one for up to 9 (matching
// the site reader's _cdnUrls window) so scroll-back and re-opens spend no
// page-API call, leaving a safe margin before the signature expires.
const SIGNED_URL_TTL_MS = 9 * 60 * 1000;
// Cap the signed-URL cache so a long binge across many chapters can't grow it
// without bound; the oldest entry is evicted first (Map keeps insertion order).
const SIGNED_URL_CACHE_MAX = 512;

// Shared page-API strike state. A frequency 429 raises the sustained pacing
// floor for a short while (`strikeUntil`) so a heavy binge doesn't immediately
// re-trip the limiter right after recovering. Epoch ms.
const pageCooldown = { strikeUntil: 0 };

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

  // De-duped reader-token refreshes: a prefetch burst can 401/403 many pages at
  // once, so the first refresh mints a token and the rest await that one result.
  private refreshInFlight = new Map<string, Promise<boolean>>();

  // Resolved signed CDN URLs, keyed `cid|order`. Serving a page from here on
  // scroll-back / re-open skips the page-API call, its token, and its rate-limit
  // budget — the site reader's _cdnUrls shortcut.
  private signedUrls = new Map<string, { url: string; at: number }>();

  setReaderToken(chapterId: string, token: string, referer: string): void {
    this.readerSessions.set(chapterId, { token, referer, pagesServed: 0 });
  }

  // Run at most one token refresh (light or full) per chapter per window: a
  // prefetch burst can 401/403 many pages at once, and a dead session would
  // otherwise trigger one refresh per page. The first caller runs `mint`; the
  // rest await its result, and a refresh moments ago is reused outright. A
  // Cloudflare challenge on the refresh propagates so the app opens the bypass.
  private async coalesceRefresh(cid: string, mint: () => Promise<boolean>): Promise<boolean> {
    const existing = this.refreshInFlight.get(cid);
    if (existing) return existing;

    const session = this.readerSessions.get(cid);
    if (!session) return false;

    if (
      session.refreshedAt !== undefined &&
      Date.now() - session.refreshedAt < OniSagaInterceptor.REFRESH_MIN_INTERVAL_MS
    ) {
      return session.refreshOk ?? false;
    }

    const task = mint().catch((error: unknown) => {
      if (error instanceof CloudflareError) throw error;
      // Stamp the failure too, so a transient error doesn't invite an immediate
      // refresh storm; the next window is free to try again.
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

  // Light token refresh via the site's dedicated endpoint
  // (GET /api/chapter/{cid}/reader-token -> { token }), exactly like the site
  // reader's refreshReaderToken(). Recovers an expired token on a 401/403 for
  // the cost of one small JSON request — no full reader-page reload.
  private refreshReaderToken(cid: string): Promise<boolean> {
    return this.coalesceRefresh(cid, async () => {
      const session = this.readerSessions.get(cid);
      if (!session) return false;
      const [, body] = await Application.scheduleRequest({
        url: `${DOMAIN}/api/chapter/${cid}/reader-token`,
        method: "GET",
        headers: { referer: session.referer, accept: "application/json" },
      });
      const dto = JSON.parse(Application.arrayBufferToUTF8String(body)) as {
        token?: string | null;
      };
      session.refreshedAt = Date.now();
      session.refreshOk = Boolean(dto.token);
      if (!dto.token) return false;
      session.token = dto.token;
      session.pagesServed = 0;
      return true;
    });
  }

  // Full session re-home by reloading the reader page. A fresh reader-page load
  // mints a token with a fresh session key (and page budget), which the light
  // token endpoint doesn't — so this is what proactively carries a long chapter
  // past the "Session page limit" quota.
  private refreshSession(cid: string): Promise<boolean> {
    return this.coalesceRefresh(cid, async () => {
      const session = this.readerSessions.get(cid);
      if (!session) return false;
      const [, page] = await Application.scheduleRequest({ url: session.referer, method: "GET" });
      const token = extractReaderToken(Application.arrayBufferToUTF8String(page));
      session.refreshedAt = Date.now();
      session.refreshOk = Boolean(token);
      if (!token) return false;
      session.token = token;
      session.pagesServed = 0;
      return true;
    });
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
    const pageApiMatch = PAGE_API_REGEX.exec(request.url);
    const cid = pageApiMatch?.[1];
    if (cid) {
      const session = this.readerSessions.get(cid);

      // Serve a still-fresh signed CDN URL directly, skipping the page-API call
      // (and the token / rate-limit budget it spends) — the site reader's
      // _cdnUrls shortcut for scroll-back and re-opens. Capped under the ~10-min
      // signing lifetime so a served URL never expires mid-view. The rewritten
      // URL is no longer a page-API path, so the rate limiter (registered after
      // us) skips pacing it and interceptResponse returns its bytes untouched.
      const order = pageApiMatch?.[2];
      if (order !== undefined) {
        const cached = this.signedUrls.get(`${cid}|${order}`);
        if (cached && Date.now() - cached.at < SIGNED_URL_TTL_MS) {
          return {
            ...request,
            url: cached.url,
            headers: {
              "user-agent": headers["user-agent"],
              referer: session?.referer ?? `${DOMAIN}/`,
              accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
          };
        }
      }

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
    } else if (headers.accept === undefined && headers.Accept === undefined) {
      // Plain HTML fetches (reader page, /home, /manga, /browse) get a browser
      // document Accept, matching the site's own reader. A request with no
      // Accept looks bot-shaped and is likelier to draw a Cloudflare challenge —
      // the transient cause of a reader page arriving without its token. Livewire
      // calls set their own Accept: application/json, so they're left untouched.
      headers.accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
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

    const pageApiMatch = PAGE_API_REGEX.exec(request.url);
    const cid = pageApiMatch?.[1];
    const session = cid ? this.readerSessions.get(cid) : undefined;

    // The reader can rotate the chapter token; adopt the replacement so later
    // page requests stay authorized (the site's own reader does the same).
    const nextToken = getHeaderValue(response.headers, "x-reader-token-next");
    if (session && nextToken) session.token = nextToken;

    // Reader tokens expire after ~10 minutes, and the app requests pages long
    // after the chapter was opened. On an auth failure, refresh the token via the
    // site's dedicated endpoint and retry; the retry re-enters this interceptor
    // with the new token, bounded by a retry-count header.
    if (session && cid && (response.status === 403 || response.status === 401)) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT && (await this.refreshReaderToken(cid))) {
        const [, buffer] = await Application.scheduleRequest({
          url: request.url,
          method: "GET",
          headers: { ...request.headers, [PAGE_RETRY_HEADER]: String(attempt + 1) },
        });
        return buffer;
      }
    }

    // A page-API 429 ("Rate limit exceeded") is the frequency limiter, not an
    // auth problem — the site's own reader never re-mints on it. It's a rolling
    // window that refills in a few seconds, so the fix is exactly what the site
    // does in resolvePageUrl: wait a short, jittered slice — capped at ~6s, NOT
    // the advertised 60s Retry-After — and retry. Re-minting here is useless (a
    // fresh token still 429s) and the reader-page reload it costs only adds load
    // to the saturated window. Raising the sustained floor for a short while
    // (strikeUntil) keeps a heavy binge from immediately re-tripping the limiter.
    if (PAGE_API_REGEX.test(request.url) && response.status === 429) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        const jitterMs = Date.now() % 500;
        const waitMs = Math.min(
          RATE_LIMIT_MAX_WAIT_MS,
          getRetryDelayMs(response.headers) + jitterMs,
        );
        pageCooldown.strikeUntil = Date.now() + STRIKE_DECAY_MS;
        await Application.sleep(waitMs / 1000);
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
          // Cache the signed URL so a scroll-back / re-open of this page serves
          // from it (interceptRequest) instead of spending another page-API call.
          const order = pageApiMatch?.[2];
          if (cid && order !== undefined) {
            this.signedUrls.set(`${cid}|${order}`, { url: dto.url, at: Date.now() });
            if (this.signedUrls.size > SIGNED_URL_CACHE_MAX) {
              const oldest = this.signedUrls.keys().next().value;
              if (oldest !== undefined) this.signedUrls.delete(oldest);
            }
          }
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
            // Match the site's own reader on the signed-image fetch: a browser
            // image Accept header alongside the Referer. Some signed pages come
            // back unrenderable without it (the CDN/Cloudflare treats a missing
            // Accept differently); it ends in */* so it can only broaden what the
            // server may return, never reject.
            headers: {
              referer: session?.referer ?? `${DOMAIN}/`,
              accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
          });
          return imageBuffer;
        }
        // A 200 with no url is a JSON error payload (e.g. an expired token
        // reported with a `message`), which would otherwise render as broken
        // image bytes. Refresh the token and retry, like the 401/403 path.
        if (session && cid && dto.message) {
          const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
          if (attempt < PAGE_RETRY_LIMIT && (await this.refreshReaderToken(cid))) {
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
// A small, gentle opener for a snappy first screen. Kept modest (4 pages, 0.5s
// apart) on purpose: onisaga's frequency limiter is a rolling ~60-req/min window
// across the whole session, so a big fast burst (10 @ 0.3s ≈ 200/min) spikes a
// window already loaded from earlier chapters and trips a 429 mid-read. Four
// half-second pages front-load the first screen without spiking the window.
const BURST_CAPACITY = 4;
const BURST_SPACING_SECONDS = 0.5;

// The first couple of opener pages fire back-to-back (no spacing) — a 2-wide
// parallel opener matching the site reader's _preloadMax: 2 — so the first
// screen paints instantly; the rest of the opener is lightly spaced. Two
// requests can't spike the ~60/min window, and sustained reading still settles
// to the safe floor below, so this stays stall-free.
const BURST_CONCURRENCY = 2;

// Sustained floor, evenly enforced. onisaga's limiter is a rolling ~60/min
// window across the session (not per-chapter): sustained faster than that trips
// a "Rate limit exceeded" 429 with a 60s Retry-After stall. ~1.1s (~55/min)
// keeps a margin under it so continuous reading stays stall-free — the fastest
// rate that doesn't periodically freeze for 60s. The user's Image Requests Limit
// can only make it slower; it can't undercut this and re-trip the limiter.
const SUSTAINED_FLOOR_SECONDS = 1.1;

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
    // Minimum interval since the previous page request. The opener fires a few
    // quick pages — its first couple back-to-back for a 2-wide first screen —
    // after that every request is evenly spaced at the user's setting, floored to
    // the sustainable rate (raised further while a strike is cooling). Even
    // spacing — not a rolling average — is what keeps the short-window frequency
    // limiter from tripping, since it never lets a burst of requests stack up
    // inside the limiter's window.
    let intervalSeconds: number;
    if (this.burst > 0) {
      const fired = BURST_CAPACITY - this.burst; // 0-indexed position in the opener
      this.burst -= 1;
      intervalSeconds = fired < BURST_CONCURRENCY ? 0 : BURST_SPACING_SECONDS;
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