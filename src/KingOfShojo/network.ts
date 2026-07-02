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

    // Image GETs only need referer + user agent; dropping origin and
    // accept-language keeps the per-page request overhead minimal.
    if (IMAGE_EXTENSION_REGEX.test(request.url)) {
      return {
        ...request,
        headers: {
          ...request.headers,
          referer: `${baseUrl}/`,
          "user-agent": userAgent,
          accept: "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8",
        },
      };
    }

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
