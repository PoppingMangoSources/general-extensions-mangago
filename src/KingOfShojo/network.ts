/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

export class KingOfShojoInterceptor extends PaperbackInterceptor {
  // A reader page fires 40+ image requests; resolving the default user agent is
  // a native-bridge call, so cache it instead of paying that cost per image.
  private cachedUserAgent?: string;

  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  private async userAgent(): Promise<string> {
    if (this.cachedUserAgent === undefined) {
      this.cachedUserAgent = await Application.getDefaultUserAgent();
    }
    return this.cachedUserAgent;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();
    const userAgent = await this.userAgent();

    // Reader images mirror a real <img> load: a browser image accept + referer +
    // UA, and crucially NO origin (a browser never sends Origin for an image, and
    // that non-standard header makes cdn.kingofshojo.com reset the connection).
    // The reference MangaThemesia implementations all fetch images this way.
    if (IMAGE_EXTENSION_REGEX.test(request.url)) {
      const headers = { ...request.headers };
      delete headers.origin;
      delete headers.Origin;
      return {
        ...request,
        headers: {
          ...headers,
          referer: `${baseUrl}/`,
          "user-agent": userAgent,
          accept: "image/avif,image/webp,image/png,image/jpeg,*/*",
          "accept-language": "en-US,en;q=0.5",
        },
      };
    }

    // Page/API requests keep full browser-like headers so the HTML fetch doesn't
    // trip the site's Cloudflare challenge.
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${baseUrl}/`,
        origin: baseUrl,
        "user-agent": userAgent,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.5",
      },
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
        headers: { "user-agent": await this.userAgent() },
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