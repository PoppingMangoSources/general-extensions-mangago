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

export class VyMangaInterceptor extends PaperbackInterceptor {
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
        headers: {
          ...request.headers,
          referer: `${baseUrl}/`,
          "user-agent": await Application.getDefaultUserAgent(),
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
        "user-agent": await Application.getDefaultUserAgent(),
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
    const contentType = response.headers?.["content-type"] ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(body)
    ) {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
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
  const body = Application.arrayBufferToUTF8String(data);
  if (/<title>Site Unavailable<\/title>|Unable to access this site/i.test(body)) {
    throw new Error("VyManga is currently unavailable from this network.");
  }
  return cheerio.load(body, {
    xml: { xmlMode: false, decodeEntities: false },
  });
};
