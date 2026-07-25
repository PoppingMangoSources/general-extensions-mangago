/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import {
  DOMAIN,
  PAGE_BUDGET_BLOCKED_UNTIL_KEY,
  PAGE_BUDGET_HISTORY_KEY,
  PAGE_TOKEN_BUCKET_KEY,
  type PageApiResponse,
} from "./models";
import { getPageDelaySeconds } from "./utils/helpers";

// Reader page-API url; captures chapter id + page order.
const PAGE_API_REGEX = /\/api\/chapter\/([^/]+)\/page\/(\d+)/;

// Marks the internal page-API lookup; stripped in interceptRequest, prevents the
// nested lookup from recursively resolving itself.
const PAGE_RESOLVE_HEADER = "x-pb-page-resolve";

// A nested scheduleRequest challenge must be promoted to the outer page response
// before Paperback can launch bypass.
class PageResolverCloudflareChallengeError extends Error {}

// Bounds re-entrant page retries; matches keiyoushi's `attempt < 3` cap.
const PAGE_RETRY_HEADER = "x-pb-page-retry";
const PAGE_RETRY_LIMIT = 3;
// Fallback wait when a 429 carries no Retry-After (keiyoushi's `rateLimitDelay`).
const RATE_LIMIT_FALLBACK_MS = 2000;
// Ceiling for ordinary, non-reader Retry-After values; the page API's much longer
// block uses the separate rolling-budget circuit below.
const MAX_COOLDOWN_MS = 90_000;

// Signed CDN URL valid ~10 min; cache 9 min (site reader's _cdnUrls window) so
// scroll-back/re-opens spend no page-API call, with margin before expiry.
const SIGNED_URL_TTL_MS = 9 * 60 * 1000;
// Cap the signed-URL cache; oldest evicted first (Map keeps insertion order).
const SIGNED_URL_CACHE_MAX = 512;

// A second long reader budget, unrelated to the advertised 300-request counter:
// field runs 429ed near protected lookup ~389 and only recovered once the oldest
// requests aged past an hour. Keep 50 headroom below the observed ~400 ceiling;
// the 65-minute window adds a boundary margin.
export const PAGE_BUDGET_WINDOW_MS = 65 * 60 * 1000;
export const PAGE_BUDGET_MAX_REQUESTS = 350;

// Start fast, then refill at a rate that stays inside 350/65-min: 30 burst tokens
// + 320 refills. The rolling history remains a hard backstop (covers alpha.16).
export const PAGE_BURST_CAPACITY = 30;
export const PAGE_TOKEN_REFILL_INTERVAL_MS =
  PAGE_BUDGET_WINDOW_MS / (PAGE_BUDGET_MAX_REQUESTS - PAGE_BURST_CAPACITY);

// Waits longer than this surface a countdown instead of holding Paperback at 0%.
export const PAGE_MAX_INLINE_WAIT_MS = 30_000;

export type PageTokenBucketState = {
  tokens: number;
  updatedAt: number;
};

// Shared page-API circuit: a 429 parks the retry and all queued pages for the
// long safety window, avoiding minute-by-minute probes against a saturated quota.
const pageCooldown = { until: 0 };

// Paperback reports a bare iOS WebView UA; Cloudflare treats it differently from
// the challenge WebView's full Safari UA, so fill only the missing browser tokens.
export function completeMobileSafariUserAgent(userAgent: string): string {
  if (!/\b(?:iPhone|iPad|iPod)\b/.test(userAgent) || /\bSafari\//.test(userAgent)) {
    return userAgent;
  }
  const os = /\bOS (\d+)[_.](\d+)/.exec(userAgent);
  const version = os ? `${os[1]}.${os[2]}` : "18.0";
  const withVersion = /\bVersion\//.test(userAgent)
    ? userAgent
    : userAgent.replace(/\sMobile\//, ` Version/${version} Mobile/`);
  return /\bSafari\//.test(withVersion) ? withVersion : `${withVersion} Safari/604.1`;
}

function withHeaders(
  headers: Record<string, string> | undefined,
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const replaced = new Set(Object.keys(overrides).map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!replaced.has(key.toLowerCase())) result[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

async function getOniSagaUserAgent(): Promise<string> {
  return completeMobileSafariUserAgent(await Application.getDefaultUserAgent());
}

// Response headers can arrive in any casing; read them case-insensitively.
export function getHeaderValue(
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
export function getRetryDelayMs(headers: Record<string, string> | undefined): number {
  const retryAfter = Number(getHeaderValue(headers, "retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RATE_LIMIT_FALLBACK_MS;
}

// Cloudflare marks managed challenges with `cf-mitigated`; keep a narrow HTML
// fallback for runtimes that omit it, without mistaking onisaga's JSON token 403s
// for a challenge just because the site sits behind Cloudflare.
export function isCloudflareChallengeResponse(
  url: string,
  status: number,
  headers: Record<string, string> | undefined,
  bodyText = "",
): boolean {
  if (!url.startsWith(DOMAIN)) return false;
  if (getHeaderValue(headers, "cf-mitigated")?.toLowerCase() === "challenge") return true;
  if (status !== 403) return false;

  const contentType = getHeaderValue(headers, "content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/html")) return false;
  return /just a moment|challenge-platform|cf-browser-verification|_cf_chl_opt/i.test(bodyText);
}

// Sanitize persisted history before it affects pacing. Sorting also makes the
// result stable if a previous build wrote starts while the device clock moved.
export function normalisePageRequestStarts(value: unknown, now: number): number[] {
  if (!Array.isArray(value)) return [];
  const cutoff = now - PAGE_BUDGET_WINDOW_MS;
  return value
    .filter(
      (startedAt): startedAt is number =>
        typeof startedAt === "number" &&
        Number.isFinite(startedAt) &&
        startedAt > cutoff &&
        startedAt <= now,
    )
    .sort((a, b) => a - b)
    .slice(-PAGE_BUDGET_MAX_REQUESTS);
}

// Earliest safe start under the rolling budget; at capacity the oldest charged
// lookup must age out first.
export function pageBudgetReadyAt(starts: number[], now: number): number {
  const recent = normalisePageRequestStarts(starts, now);
  if (recent.length < PAGE_BUDGET_MAX_REQUESTS) return now;
  return (recent[0] ?? now) + PAGE_BUDGET_WINDOW_MS;
}

function refillPageTokenBucket(state: PageTokenBucketState, now: number): PageTokenBucketState {
  if (now <= state.updatedAt) return state;
  return {
    tokens: Math.min(
      PAGE_BURST_CAPACITY,
      state.tokens + (now - state.updatedAt) / PAGE_TOKEN_REFILL_INTERVAL_MS,
    ),
    updatedAt: now,
  };
}

function isPageTokenBucketState(value: unknown, now: number): value is PageTokenBucketState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<PageTokenBucketState>;
  return (
    typeof candidate.tokens === "number" &&
    Number.isFinite(candidate.tokens) &&
    candidate.tokens >= 0 &&
    typeof candidate.updatedAt === "number" &&
    Number.isFinite(candidate.updatedAt) &&
    candidate.updatedAt <= now
  );
}

// Restore the bucket and reconcile history entries written after it (e.g. the app
// stopped between the two writes). On first alpha.17 launch, replay alpha.16
// history from a full bucket so a busy install doesn't get a fresh 30-request burst.
export function normalisePageTokenBucket(
  value: unknown,
  starts: number[],
  now: number,
): PageTokenBucketState {
  const recent = normalisePageRequestStarts(starts, now);
  const persisted = isPageTokenBucketState(value, now);
  let state: PageTokenBucketState = persisted
    ? {
        tokens: Math.min(PAGE_BURST_CAPACITY, value.tokens),
        updatedAt: value.updatedAt,
      }
    : {
        tokens: PAGE_BURST_CAPACITY,
        updatedAt: recent[0] ?? now,
      };

  const unaccountedStarts = persisted
    ? recent.filter((startedAt) => startedAt > state.updatedAt)
    : recent;
  for (const startedAt of unaccountedStarts) {
    state = refillPageTokenBucket(state, startedAt);
    state = { tokens: Math.max(0, state.tokens - 1), updatedAt: startedAt };
  }

  return refillPageTokenBucket(state, now);
}

export function pageTokenReadyAt(state: PageTokenBucketState, now: number): number {
  const refilled = refillPageTokenBucket(state, now);
  if (refilled.tokens >= 1) return now;
  return now + (1 - refilled.tokens) * PAGE_TOKEN_REFILL_INTERVAL_MS;
}

export function consumePageToken(state: PageTokenBucketState, now: number): PageTokenBucketState {
  const refilled = refillPageTokenBucket(state, now);
  return { tokens: Math.max(0, refilled.tokens - 1), updatedAt: now };
}

export function formatPageSafetyPause(waitMs: number): string {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  const duration =
    seconds < 90
      ? `${seconds} second${seconds === 1 ? "" : "s"}`
      : `${Math.ceil(seconds / 60)} minutes`;
  return `OniSaga safety pause — retry in about ${duration}. This prevents the site's hour-long page lockout.`;
}

function readBlockedUntil(now: number): number {
  const value = Number(Application.getState(PAGE_BUDGET_BLOCKED_UNTIL_KEY) ?? 0);
  if (!Number.isFinite(value) || value <= now) {
    if (value !== 0) Application.setState(undefined, PAGE_BUDGET_BLOCKED_UNTIL_KEY);
    return 0;
  }
  return value;
}

function rememberLongPageBlock(now: number): number {
  const until = now + PAGE_BUDGET_WINDOW_MS;
  pageCooldown.until = Math.max(pageCooldown.until, until);
  Application.setState(until, PAGE_BUDGET_BLOCKED_UNTIL_KEY);
  return until;
}

export class OniSagaInterceptor extends PaperbackInterceptor {
  // Per-chapter reader sessions (chapterId -> token + reader-page referer) set by
  // getChapterDetails; the page API wants both, like the site's own reader.
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

  // Preserve the reader-page referer across CDN redirects. Paperback does not
  // run normal interceptors again for redirect follow-ups, and some CDN targets
  // reject a valid signature when the browser headers disappear.
  private redirectReferers = new Map<string, string>();

  // Paperback can ask for the visible page and prefetch the same page at nearly
  // the same time. Coalesce those lookups so one page consumes one protected API
  // request and one slot in the paced queue. This is the Paperback equivalent of
  // Aidoku resolving a page in get_image_request before returning the real image
  // request to the app.
  private pageResolveInFlight = new Map<string, Promise<string>>();

  // URLs currently being fetched by the nested resolver. While one is in this
  // set, interceptResponse returns a Cloudflare challenge body to resolveSignedUrl
  // instead of throwing from the nested response and turning it into an
  // Alamofire request-adaptation error. The outer request cannot reach the same
  // URL concurrently because it is awaiting this lookup.
  private pageResolveNetworkRequests = new Set<string>();

  setReaderToken(chapterId: string, token: string, referer: string): void {
    this.readerSessions.set(chapterId, { token, referer });
  }

  // Called by the final page-only limiter immediately before the HTTP request.
  // A queued request can wait at the rolling-hour gate long enough for another
  // request to rotate its chapter token, so stamp the newest token/referer after
  // that wait rather than relying on the earlier interceptor pass.
  async preparePageRequest(request: Request): Promise<void> {
    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    if (!cid) return;
    const session = this.readerSessions.get(cid);
    if (!session) return;

    request.headers = withHeaders(request.headers, {
      "x-reader-token": session.token,
      referer: session.referer,
    });
  }

  private rememberRedirectReferer(url: string, referer: string): void {
    this.redirectReferers.delete(url);
    this.redirectReferers.set(url, referer);
    if (this.redirectReferers.size > SIGNED_URL_CACHE_MAX) {
      const oldest = this.redirectReferers.keys().next().value;
      if (oldest !== undefined) this.redirectReferers.delete(oldest);
    }
  }

  async prepareRedirect(request: Request, redirectedResponse: Response): Promise<Request> {
    const rememberedReferer = this.redirectReferers.get(redirectedResponse.url);
    const referer = getHeaderValue(request.headers, "referer") ?? rememberedReferer ?? `${DOMAIN}/`;
    const origin = getHeaderValue(request.headers, "origin");
    const isImageRedirect =
      rememberedReferer !== undefined ||
      /(?:^|,)\s*image\//i.test(getHeaderValue(request.headers, "accept") ?? "");
    let headers = withHeaders(request.headers, {
      origin,
      referer,
      "user-agent": await getOniSagaUserAgent(),
    });

    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    const session = cid ? this.readerSessions.get(cid) : undefined;
    if (session) {
      headers = withHeaders(headers, {
        accept: "*/*",
        origin: undefined,
        referer: session.referer,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-reader-token": session.token,
      });
    } else if (isImageRedirect) {
      headers = withHeaders(headers, {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        origin: undefined,
        referer,
      });
      this.rememberRedirectReferer(request.url, referer);
    }

    request.headers = headers;
    return request;
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
    const headers = withHeaders(request.headers, {
      accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      origin: undefined,
      referer,
      "x-reader-token": undefined,
      "sec-fetch-dest": undefined,
      "sec-fetch-mode": undefined,
      "sec-fetch-site": undefined,
    });
    // Update the shared request object as well as returning it. Paperback's app
    // chains interceptor return values, while the alpha.92 toolkit mock currently
    // passes the original object to each later interceptor. Mutating here (as the
    // built-in CookieStorageInterceptor does) keeps both runtimes on the same URL.
    request.url = url;
    request.headers = headers;
    this.rememberRedirectReferer(url, referer);
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
      this.pageResolveNetworkRequests.add(request.url);
      let response: Response;
      let buffer: ArrayBuffer;
      try {
        [response, buffer] = await Application.scheduleRequest({
          url: request.url,
          method: "GET",
          headers: { ...request.headers, [PAGE_RESOLVE_HEADER]: "1" },
        });
      } finally {
        this.pageResolveNetworkRequests.delete(request.url);
      }
      const raw = Application.arrayBufferToUTF8String(buffer);
      if (isCloudflareChallengeResponse(request.url, response.status, response.headers, raw)) {
        throw new PageResolverCloudflareChallengeError();
      }
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

  // Run at most one token refresh per chapter per window: a
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

  override async interceptRequest(request: Request): Promise<Request> {
    // Keep a caller-provided Referer/Origin (Livewire calls send page-specific
    // ones); normalize to lower-case so the map never carries both casings.
    // Origin is only sent when a caller set it (browsers omit it on plain GETs).
    const isPageResolver = getHeaderValue(request.headers, PAGE_RESOLVE_HEADER) === "1";
    // This header is source-private control data, not part of onisaga's protocol.
    const referer = getHeaderValue(request.headers, "referer") ?? `${DOMAIN}/`;
    const origin = getHeaderValue(request.headers, "origin");
    let headers = withHeaders(request.headers, {
      [PAGE_RESOLVE_HEADER]: undefined,
      origin,
      referer,
      "user-agent": await getOniSagaUserAgent(),
    });
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
        try {
          const signedUrl = await this.resolveSignedUrl(request, cid, order);
          return this.imageRequest(request, signedUrl, session?.referer ?? `${DOMAIN}/`);
        } catch (error) {
          if (
            !(error instanceof PageResolverCloudflareChallengeError) &&
            !(error instanceof CloudflareError)
          ) {
            throw error;
          }
          // The lookup above runs inside request adaptation. Propagating its
          // CloudflareError from here becomes Alamofire.requestAdaptationFailed,
          // which Paperback cannot turn into its bypass banner. Let this outer
          // page request reach the same endpoint once: the managed-challenge
          // response then reaches interceptResponse below, where CloudflareError
          // is emitted from the supported response stage. Once the user solves
          // it, Paperback retries and the nested lookup resolves normally.
        }
      }

      if (session) {
        // Mirror the site reader's fetch exactly (verified against a live
        // devtools capture): Accept */* (fetch default — not application/json),
        // the full sec-fetch trio, and NO Origin header (browsers omit it on
        // same-origin GETs, cors mode notwithstanding).
        headers = withHeaders(headers, {
          accept: "*/*",
          origin: undefined,
          referer: session.referer,
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-reader-token": session.token,
        });
      }
    } else if (getHeaderValue(headers, "accept") === undefined) {
      // Plain HTML fetches (reader page, /home, /manga, /browse) get a browser
      // document Accept, matching the site's own reader. A request with no
      // Accept looks bot-shaped and is likelier to draw a Cloudflare challenge —
      // the transient cause of a reader page arriving without its token. Livewire
      // calls set their own Accept: application/json, so they're left untouched.
      headers = withHeaders(headers, {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      });
    }

    request.headers = headers;
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const challengeBody = response.status === 403 ? Application.arrayBufferToUTF8String(data) : "";
    if (
      isCloudflareChallengeResponse(request.url, response.status, response.headers, challengeBody)
    ) {
      // This response belongs to the scheduleRequest nested inside
      // interceptRequest. Hand it back to resolveSignedUrl, which converts it to
      // an internal sentinel and lets the outer request make the challenge at a
      // response stage Paperback can handle.
      if (this.pageResolveNetworkRequests.has(request.url)) return data;

      // Kagane's working bypass path preserves the challenged request URL and
      // headers. In particular, using the actual protected endpoint lets
      // Cloudflare solve the same rule that rejected it; opening only `/` can be
      // a clean 200 while the API path remains challenged.
      const resolutionHeaders = withHeaders(request.headers, {
        [PAGE_RETRY_HEADER]: undefined,
        [PAGE_RESOLVE_HEADER]: undefined,
        "user-agent": await getOniSagaUserAgent(),
      });
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: resolutionHeaders,
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

    // Page-API 429 recovery. Field evidence showed Retry-After: 60 is misleading
    // for the long reader budget: new sessions/tokens and minute-spaced probes
    // remained blocked, while the API recovered after the roughly hourly window.
    // Persist one shared long circuit-breaker. Do not keep this image response
    // open until it expires: Paperback presents that as an unexplained 0% load.
    // Fail with the remaining duration so a manual retry can resume later.
    // The proactive gate below should normally prevent this path; it remains for
    // usage from the website/another device or state cleared mid-window.
    if (PAGE_API_REGEX.test(request.url) && response.status === 429) {
      const now = Date.now();
      const blockedUntil = rememberLongPageBlock(now);
      throw new Error(formatPageSafetyPause(blockedUntil - now));
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

// Reader page-API pacing. Requests are strictly serialized and evenly spaced at
// the user's Image Requests Limit (2s by default). A persisted token bucket lets
// ordinary chapters start quickly, then settles sustained reading to the safe
// 350/65-minute envelope. The retained rolling history is a hard backstop. Long
// safety waits fail with a countdown instead of holding Paperback at 0%. Only
// the protected page API is paced; signed CDN images and ordinary requests pass.

export class OniSagaPageRateLimiter extends PaperbackInterceptor {
  private chain: Promise<unknown> = Promise.resolve();
  // Fire time of the last page request, for even inter-request spacing.
  private lastRequestAt = 0;
  private requestStarts: number[] = [];
  private tokenBucket: PageTokenBucketState = {
    tokens: PAGE_BURST_CAPACITY,
    updatedAt: 0,
  };
  private stateLoaded = false;
  constructor(
    id: string,
    private readonly beforePageRequest?: (request: Request) => Promise<void>,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    if (!cid) return request;
    // Serialize every page request through one chain so no two are ever in
    // flight together; pace() then even-spaces them.
    const wait = this.chain.then(async () => {
      await this.pace();
      await this.beforePageRequest?.(request);
    });
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
    const intervalMs = getPageDelaySeconds() * 1000;

    // Re-evaluate after every sleep. A response can open/extend the shared
    // circuit while this queued request is already waiting for normal spacing;
    // a one-shot calculation would let it slip into the blocked window.
    for (;;) {
      const now = Date.now();
      this.loadState(now);
      this.requestStarts = normalisePageRequestStarts(this.requestStarts, now);
      this.tokenBucket = normalisePageTokenBucket(this.tokenBucket, this.requestStarts, now);

      const waitUntil = Math.max(
        pageCooldown.until,
        readBlockedUntil(now),
        this.lastRequestAt + intervalMs,
        pageBudgetReadyAt(this.requestStarts, now),
        pageTokenReadyAt(this.tokenBucket, now),
      );
      const waitMs = waitUntil - now;

      if (waitMs > 0) {
        if (waitMs > PAGE_MAX_INLINE_WAIT_MS) {
          throw new Error(formatPageSafetyPause(waitMs));
        }
        await Application.sleep(waitMs / 1000);
        continue;
      }

      const startedAt = Date.now();
      this.lastRequestAt = startedAt;
      this.tokenBucket = consumePageToken(this.tokenBucket, startedAt);
      this.requestStarts.push(startedAt);
      this.saveState();
      return;
    }
  }

  private loadState(now: number): void {
    if (this.stateLoaded) return;
    this.requestStarts = normalisePageRequestStarts(
      Application.getState(PAGE_BUDGET_HISTORY_KEY),
      now,
    );
    this.tokenBucket = normalisePageTokenBucket(
      Application.getState(PAGE_TOKEN_BUCKET_KEY),
      this.requestStarts,
      now,
    );
    this.stateLoaded = true;
  }

  private saveState(): void {
    // Save the bucket first. If the app stops between writes, losing one token
    // is conservative; the opposite order could grant an uncharged request.
    Application.setState(this.tokenBucket, PAGE_TOKEN_BUCKET_KEY);
    Application.setState(this.requestStarts, PAGE_BUDGET_HISTORY_KEY);
  }
}
