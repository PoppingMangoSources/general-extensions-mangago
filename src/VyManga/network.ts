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

// vymanga.com serves a different (mobile) page layout to the device's default
// iOS user agent, where the chapter list points at stray nav links. A desktop
// user agent returns the layout the parsers expect.
const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export class VyMangaInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();

    // Image GETs only need referer + user agent; dropping origin and
    // accept-language keeps the per-page request overhead minimal.
    if (IMAGE_EXTENSION_REGEX.test(request.url)) {
      return {
        ...request,
        headers: {
          ...request.headers,
          referer: `${baseUrl}/`,
          "user-agent": DESKTOP_USER_AGENT,
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
        "user-agent": DESKTOP_USER_AGENT,
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
        headers: { "user-agent": DESKTOP_USER_AGENT },
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
