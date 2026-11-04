/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN, READER_USER_AGENT, type FeaturedDetail } from "./models";
import { parseFeaturedDetail } from "./parsers";
import { descrambleMangagoImage, parseImageContext } from "./utils/descramble";
import {
  absoluteUrl,
  isReaderMirrorHost,
  readerHostOf,
  readerOrigin,
  readerPathOf,
} from "./utils/urls";

// True for mangago.me + its reader mirrors (which need the _m_superu cookie), false
// for image CDN hosts (which must not receive it).
function isMangagoHost(url: string): boolean {
  const host = readerHostOf(url);
  if (!host) return url.startsWith("/"); // a relative path is same-origin mangago
  return host === "mangago.me" || host.endsWith(".mangago.me") || isReaderMirrorHost(host);
}

// A reader page (/read-manga/<slug>/<more> or numeric /chapter/<mid>/<cid>/) takes
// the desktop UA; everything else takes the mobile UA so chapter links come back as
// read-manga URLs.
function isReaderPageUrl(url: string): boolean {
  const pathname = readerPathOf(url);
  const readManga = /^\/read-manga\/[^/]+\/(.+)/.exec(pathname);
  if (readManga && readManga[1].length > 0) return true;
  return /^\/chapter\/\d+\/\d+/.test(pathname);
}

async function readerHeadersForUrl(url: string): Promise<{
  referer: string;
  origin: string;
  "user-agent": string;
}> {
  // Same-origin referer/origin (numeric readers may be on a mirror). Reader pages
  // force the desktop UA (+ _m_superu) for the full image list; everything else
  // uses the app's default (mobile) UA so chapter links come back as read-manga URLs.
  const reader = isReaderPageUrl(url);
  const origin = reader ? readerOrigin(url) : DOMAIN;
  return {
    referer: `${origin}/`,
    origin,
    "user-agent": reader ? READER_USER_AGENT : await Application.getDefaultUserAgent(),
  };
}

// Apply page-type UA + referer/origin and merge _m_superu=1 into the cookies.
// Shared by interceptRequest and the redirect handler so headers survive a
// redirect (the app only runs interceptRequest on the initial request). Only
// mangago.me hosts get the cookie; image CDN hosts must not receive it.
export async function applyMangagoHeaders(request: Request): Promise<Request> {
  return {
    ...request,
    headers: {
      // Any header explicitly set on the request wins, so a reader fetch's forced
      // desktop UA can't be downgraded by URL classification of a stale path.
      ...(await readerHeadersForUrl(request.url)),
      ...request.headers,
    },
    cookies: isMangagoHost(request.url) ? { ...request.cookies, _m_superu: "1" } : request.cookies,
  };
}

export class MangagoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return applyMangagoHeaders(request);
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          ...(await readerHeadersForUrl(request.url)),
        },
      });
    }

    // Only cspiclink images are scrambled.
    if (!request.url.includes("cspiclink")) return data;

    const context = parseImageContext(request.url);

    if (!context) return data;

    try {
      return await descrambleMangagoImage(
        data,
        context.desckey,
        context.cols,
        response.mimeType ?? "image/jpeg",
      );
    } catch {
      // Descramble failed; return the raw bytes rather than blocking the image.
      return data;
    }
  }
}

// Fetch a page's HTML plus the final URL after redirects — the reader walk keys
// off it (numeric /chapter/ redirects to /read-manga/).
export async function fetchPage(
  url: string,
  headers: { [key: string]: string } = {},
): Promise<{ html: string; finalUrl: string }> {
  const [response, data] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: {
      ...(await readerHeadersForUrl(url)),
      ...headers,
    },
  });

  return {
    html: Application.arrayBufferToUTF8String(data),
    finalUrl: response.url || url,
  };
}

// Fetch fields for FeaturedCarouselItem (rating/status/author/summary only exist on detail pages).
export async function getFeaturedInfo(mangaId: string): Promise<FeaturedDetail> {
  return parseFeaturedDetail((await fetchPage(absoluteUrl(mangaId))).html);
}
