/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

// Mirrors BasicRateLimiter's internal image regex so header shaping and
// rate-limit exemption always agree on what counts as an image.
const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|webp)(\?|$)/i;

// Paperback's default UA is a bare WebView string (no "Version/.. Safari/.."),
// which Cloudflare on the image CDN flags as bot-like and resets the connection
// (iOS -1005). Send a complete mobile Safari UA — the same one the Tachiyomi
// client uses against this site — so requests read as a real browser.
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

// Replace a header regardless of the casing the incoming request used, so an
// existing "Referer"/"Accept-Language" can't shadow our lowercase override.
function withHeaders(
  headers: Record<string, string> | undefined,
  overrides: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const overridden = new Set(Object.keys(overrides).map((k) => k.toLowerCase()));
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!overridden.has(key.toLowerCase())) result[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export class KingOfShojoInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();

    // Reader images mirror a real <img> load: browser image accept + referer +
    // UA, NO origin, and the Sec-Fetch metadata a browser attaches to image
    // sub-resource requests. The image CDN's Cloudflare holds/resets requests
    // that lack these browser signals, so send them to look like a real image
    // fetch. (The reference MangaThemesia implementations rely on their HTTP
    // clients to add these automatically; Paperback does not, so we set them.)
    if (IMAGE_EXTENSION_REGEX.test(request.url)) {
      return {
        ...request,
        headers: withHeaders(request.headers, {
          origin: undefined,
          referer: `${baseUrl}/`,
          "user-agent": USER_AGENT,
          accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
          "accept-language": "en-US,en;q=0.5",
          "sec-fetch-dest": "image",
          "sec-fetch-mode": "no-cors",
          "sec-fetch-site": "cross-site",
        }),
      };
    }

    // Page/API requests keep browser-like headers so the HTML fetch doesn't
    // trip the site's Cloudflare challenge. No origin: browsers don't send it
    // on plain navigations, and the reference implementations don't either.
    return {
      ...request,
      headers: withHeaders(request.headers, {
        origin: undefined,
        referer: `${baseUrl}/`,
        "user-agent": USER_AGENT,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.5",
      }),
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": USER_AGENT },
      });
    }
    return data;
  }
}

export async function fetchCheerio(request: Request): Promise<cheerio.CheerioAPI> {
  const [response, data] = await Application.scheduleRequest(request);
  if (response.status === 404) {
    throw new Error(`Content not found: ${request.url}`);
  }
  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${request.url}`);
  }
  return cheerio.load(Application.arrayBufferToUTF8String(data), {
    xml: { xmlMode: false, decodeEntities: false },
  });
}