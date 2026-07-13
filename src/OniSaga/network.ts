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

// Marks the source's internal page-API lookup. The marker is removed in
// interceptRequest before anything is sent to onisaga; it only prevents the
// nested lookup from recursively trying to resolve itself.
const PAGE_RESOLVE_HEADER = "x-pb-page-resolve";

// Bounds re-entrant page retries (the retry re-runs both interceptors); matches
// keiyoushi's `attempt < 3` retry cap.
const PAGE_RETRY_HEADER = "x-pb-page-retry";
const PAGE_RETRY_LIMIT = 3;
// Fallback wait when a 429 carries no Retry-After — the even-spacing delay, like
// keiyoushi's `rateLimitDelay` fallback.
const RATE_LIMIT_FALLBACK_MS = 2000;
// Ceiling so a pathological Retry-After can't freeze the pipeline indefinitely;
// onisaga's real penalty is ~60s.
const MAX_COOLDOWN_MS = 90_000;

// A signed CDN URL is valid ~10 min; reuse a cached one for up to 9 (matching
// the site reader's _cdnUrls window) so scroll-back and re-opens spend no
// page-API call, leaving a safe margin before the signature expires.
const SIGNED_URL_TTL_MS = 9 * 60 * 1000;
// Cap the signed-URL cache so a long binge across many chapters can't grow it
// without bound; the oldest entry is evicted first (Map keeps insertion order).
const SIGNED_URL_CACHE_MAX = 512;

// Shared page-API cooldown. On a 429 the whole pipeline parks until `until` (the
// honored Retry-After) so the retry and every queued prefetch page wait the
// penalty out together instead of hammering the still-saturated window — the
// effect keiyoushi gets for free by sleeping inside its one synchronized lock.
const pageCooldown = { until: 0 };

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
  private readerSessions = new Map<
    string,
    {
      token: string;
      referer: string;
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

  // Paperback can ask for the visible page and prefetch the same page at nearly
  // the same time. Coalesce those lookups so one page consumes one protected API
  // request and one slot in the paced queue. This is the Paperback equivalent of
  // Aidoku resolving a page in get_image_request before returning the real image
  // request to the app.
  private pageResolveInFlight = new Map<string, Promise<string>>();

  setReaderToken(chapterId: string, token: string, referer: string): void {
    this.readerSessions.set(chapterId, { token, referer });
  }

  private cachedSignedUrl(key: string): string | undefined {
    const cached = this.signedUrls.get(key);
    if (!cached) return undefined;
    if (Date.now() - cached.at < SIGNED_URL_TTL_MS) return cached.url;
    this.signedUrls.delete(key);
    return undefined;
  }

  private cacheSignedUrl(key: string, url: string): void {
    // Refresh insertion order when replacing an entry so FIFO eviction remains
    // a reasonable approximation of oldest-use eviction.
    this.signedUrls.delete(key);
    this.signedUrls.set(key, { url, at: Date.now() });
    if (this.signedUrls.size > SIGNED_URL_CACHE_MAX) {
      const oldest = this.signedUrls.keys().next().value;
      if (oldest !== undefined) this.signedUrls.delete(oldest);
    }
  }

  private imageRequest(request: Request, url: string, referer: string): Request {
    const headers: Record<string, string> = { ...request.headers };
    delete headers.Accept;
    delete headers["X-Reader-Token"];
    delete headers["x-reader-token"];
    delete headers["sec-fetch-dest"];
    delete headers["sec-fetch-mode"];
    delete headers["sec-fetch-site"];
    // Update the shared request object as well as returning it. Paperback's app
    // chains interceptor return values, while the alpha.92 toolkit mock currently
    // passes the original object to each later interceptor. Mutating here (as the
    // built-in CookieStorageInterceptor does) keeps both runtimes on the same URL.
    request.url = url;
    request.headers = {
      ...headers,
      referer,
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
    return request;
  }

  private async resolveSignedUrl(request: Request, cid: string, order: string): Promise<string> {
    const key = `${cid}|${order}`;
    const cached = this.cachedSignedUrl(key);
    if (cached) return cached;

    const existing = this.pageResolveInFlight.get(key);
    if (existing) return existing;

    const task = (async () => {
      // Re-enter the normal request pipeline so cookie storage, page pacing,
      // token rotation, auth recovery and shared 429 cooldown all still apply.
      // The private marker is stripped by interceptRequest before the HTTP call.
      const [response, buffer] = await Application.scheduleRequest({
        url: request.url,
        method: "GET",
        headers: { ...request.headers, [PAGE_RESOLVE_HEADER]: "1" },
      });
      const raw = Application.arrayBufferToUTF8String(buffer);
      let dto: PageApiResponse;
      try {
        dto = JSON.parse(raw) as PageApiResponse;
      } catch (error) {
        throw new Error(`Failed to parse onisaga page response (HTTP ${response.status})`, {
          cause: error,
        });
      }
      if (!dto.url) {
        throw new Error(
          dto.message
            ? `onisaga page error: ${dto.message}`
            : `onisaga page API failed (HTTP ${response.status})`,
        );
      }
      this.cacheSignedUrl(key, dto.url);
      return dto.url;
    })();

    this.pageResolveInFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (this.pageResolveInFlight.get(key) === task) this.pageResolveInFlight.delete(key);
    }
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
      return true;
    });
  }

  // Full session re-home by reloading the reader page — a fresh load mints a
  // token with a fresh session key, which the light token endpoint doesn't. Used
  // as the last-resort recovery for a persistent 429 (like keiyoushi reloading
  // the chapter page on a failed page request), which clears a "Session page
  // limit" quota that simply waiting cannot.
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
      return true;
    });
  }

  override async interceptRequest(request: Request): Promise<Request> {
    // Keep a caller-provided Referer/Origin (Livewire calls send page-specific
    // ones); normalize to lower-case so the map never carries both casings.
    // Origin is only sent when a caller set it (browsers omit it on plain GETs).
    const headers: Record<string, string> = { ...request.headers };
    const isPageResolver = headers[PAGE_RESOLVE_HEADER] === "1";
    // This header is source-private control data, not part of onisaga's protocol.
    delete headers[PAGE_RESOLVE_HEADER];
    const referer = headers.referer ?? headers.Referer ?? `${DOMAIN}/`;
    const origin = headers.origin ?? headers.Origin;
    delete headers.Referer;
    delete headers.Origin;
    headers.referer = referer;
    if (origin) headers.origin = origin;
    headers["user-agent"] = await Application.getDefaultUserAgent();
    // Keep the request object in sync for the current toolkit mock, which passes
    // this original object (rather than the preceding interceptor's return value)
    // to later interceptors. This is also safe in Paperback's chained runtime.
    request.headers = headers;

    // A reader page-API request carries the chapter's signed token and the
    // reader page as referer, matching the site's own reader fetch.
    const pageApiMatch = PAGE_API_REGEX.exec(request.url);
    const cid = pageApiMatch?.[1];
    if (cid) {
      const session = this.readerSessions.get(cid);

      // Resolve the protected JSON endpoint here, then hand Paperback the real
      // signed image request. Besides matching Aidoku's get_image_request flow,
      // this preserves the image response's MIME/cache metadata instead of
      // substituting image bytes into an application/json response.
      const order = pageApiMatch?.[2];
      if (!isPageResolver && order !== undefined) {
        const signedUrl = await this.resolveSignedUrl(request, cid, order);
        return this.imageRequest(request, signedUrl, session?.referer ?? `${DOMAIN}/`);
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

    return request;
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
    // with the new token, bounded by a retry-count header. If the session map is
    // empty for this chapter (app relaunch with a queued download still holding
    // page-API urls), seed a bare session so the token endpoint can re-authorize
    // without the slug-based reader-page url; drop the seed if it can't, so an
    // empty token is never sent on later requests.
    if (cid && (response.status === 403 || response.status === 401)) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        const seeded = !this.readerSessions.has(cid);
        if (seeded) this.readerSessions.set(cid, { token: "", referer: `${DOMAIN}/` });
        const refreshed = await this.refreshReaderToken(cid);
        if (!refreshed && seeded) this.readerSessions.delete(cid);
        if (refreshed) {
          const [, buffer] = await Application.scheduleRequest({
            url: request.url,
            method: "GET",
            headers: {
              ...request.headers,
              [PAGE_RESOLVE_HEADER]: "1",
              [PAGE_RETRY_HEADER]: String(attempt + 1),
            },
          });
          return buffer;
        }
      }
    }

    // Page-API 429 recovery, mirroring keiyoushi's strictApiInterceptor: honor
    // the full Retry-After and retry (up to the retry cap). onisaga's frequency
    // penalty is the advertised ~60s and a fresh token does NOT clear it — only
    // the wait does, so we don't re-mint for it. Parking the whole pipeline (via
    // pageCooldown.until) makes the retry and every queued prefetch page wait the
    // penalty out together, the effect keiyoushi gets from its one lock. On the
    // final attempt we also re-home the session (a fresh reader-page load), the
    // way keiyoushi reloads the chapter page on a persistent failure. The one
    // 429 that waiting can NEVER clear is the per-session "Session page limit"
    // quota — detect it from the body and re-home immediately instead of burning
    // a pointless 60s park on it. After the retry budget, throw a clear error:
    // the JSON error body would otherwise render as a corrupt image.
    if (PAGE_API_REGEX.test(request.url) && response.status === 429) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        const sessionCapped = /session page limit/i.test(Application.arrayBufferToUTF8String(data));
        if (sessionCapped && session && cid) {
          await this.refreshSession(cid);
        } else {
          const waitMs = Math.min(getRetryDelayMs(response.headers), MAX_COOLDOWN_MS);
          pageCooldown.until = Math.max(pageCooldown.until, Date.now() + waitMs);
          if (session && cid && attempt === PAGE_RETRY_LIMIT - 1) {
            await this.refreshSession(cid);
          }
        }
        const [, buffer] = await Application.scheduleRequest({
          url: request.url,
          method: "GET",
          headers: {
            ...request.headers,
            [PAGE_RESOLVE_HEADER]: "1",
            [PAGE_RETRY_HEADER]: String(attempt + 1),
          },
        });
        return buffer;
      }
      throw new Error("onisaga is rate limiting page requests; wait a minute and retry");
    }

    // Internal page resolution returns its JSON to resolveSignedUrl. The outer
    // request has already been rewritten to the signed image URL, so Paperback
    // receives the image's real response rather than JSON response metadata with
    // substituted image bytes.
    let pageError: string | undefined;
    if (PAGE_API_REGEX.test(request.url) && response.status === 200) {
      try {
        const dto = JSON.parse(Application.arrayBufferToUTF8String(data)) as PageApiResponse;
        if (dto.url) return data;
        // A 200 with no url is a JSON error payload (e.g. an expired token
        // reported with a `message`). Refresh the token and retry, like the
        // 401/403 path; if the refresh can't recover it, surface the API message.
        if (session && cid && dto.message) {
          const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
          if (attempt < PAGE_RETRY_LIMIT && (await this.refreshReaderToken(cid))) {
            const [, buffer] = await Application.scheduleRequest({
              url: request.url,
              method: "GET",
              headers: {
                ...request.headers,
                [PAGE_RESOLVE_HEADER]: "1",
                [PAGE_RETRY_HEADER]: String(attempt + 1),
              },
            });
            return buffer;
          }
          pageError = `onisaga page error: ${dto.message}`;
        }
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        // Let resolveSignedUrl report malformed JSON with the response status.
      }
    }
    if (pageError !== undefined) throw new Error(pageError);

    return data;
  }
}

// Reader page-API pacing. onisaga's page-API limiter is BURST-sensitive, not
// just rate-sensitive: a captured devtools log showed two prefetched pages fired
// in the same instant (Paperback's chapter prefetcher hitting a parallel opener)
// trip a "Rate limit exceeded" 429 with a 60s Retry-After — even with the
// advertised per-minute counter barely touched (287/300 remaining, ~13 used). So
// page requests are strictly serialized and EVEN-spaced — never two at once,
// never a fast opener burst — at the user's Image Requests Limit (2s by default,
// keiyoushi's pref_rate_limit). The first page still fires immediately (nothing
// precedes it); everything after is one-at-a-time. Only the page API is paced
// (Webtoon-style per-endpoint scoping); everything else passes through untouched.
// The delay is honored as chosen (like keiyoushi's interceptor) — lowering it
// risks re-tripping the burst penalty, hence the settings warning.

export class OniSagaPageRateLimiter extends PaperbackInterceptor {
  private chain: Promise<unknown> = Promise.resolve();
  // Fire time of the last page request, for even inter-request spacing.
  private lastRequestAt = 0;

  override async interceptRequest(request: Request): Promise<Request> {
    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    if (!cid) return request;
    // Serialize every page request through one chain so no two are ever in
    // flight together; pace() then even-spaces them.
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
    // Park behind an open penalty cooldown first, so a 429 parks the whole
    // pipeline together (the retry and every queued prefetch page) rather than
    // each one hammering the still-saturated window.
    const cooldownMs = pageCooldown.until - Date.now();
    if (cooldownMs > 0) await Application.sleep(cooldownMs / 1000);

    // Even spacing since the previous page request — never a burst, never two
    // concurrent, which is exactly what trips onisaga's burst-sensitive limiter
    // (keiyoushi serializes on one lock for the same reason). The very first page
    // fires immediately (lastRequestAt is 0, nothing precedes it); every one after
    // is one-at-a-time at the user's chosen delay (2s default).
    const intervalSeconds = getPageDelaySeconds();

    const waitMs = this.lastRequestAt + intervalSeconds * 1000 - Date.now();
    if (waitMs > 0) await Application.sleep(waitMs / 1000);
    this.lastRequestAt = Date.now();
  }
}
