/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|webp)(\?|$)/i;

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const withHeaders = (
  headers: Record<string, string> | undefined,
  overrides: Record<string, string | undefined>,
): Record<string, string> => {
  const result: Record<string, string> = {};
  const overridden = new Set(Object.keys(overrides).map((k) => k.toLowerCase()));
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!overridden.has(key.toLowerCase())) result[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
};

export class KingOfShojoInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly getBaseUrl: () => string,
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const baseUrl = this.getBaseUrl();

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

export const fetchCheerio = async (request: Request): Promise<cheerio.CheerioAPI> => {
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
};
