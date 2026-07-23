/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { AJAX_ENDPOINT, DOMAIN, type AjaxChapterResponse } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

export class RinkoComicsInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const accept = IMAGE_EXTENSION_REGEX.test(request.url)
      ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";

    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
        accept,
        "accept-language": "en-US,en;q=0.5",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
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
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${request.url}`);
  }
  return cheerio.load(Application.arrayBufferToUTF8String(data), {
    xml: {
      xmlMode: false,
      decodeEntities: false,
    },
  });
};

// One page of the AJAX chapter list; returns the HTML fragment, or "" when the
// endpoint reports no further data.
export const fetchMoreChaptersHtml = async (
  comicId: string,
  offset: number,
  nonce: string,
): Promise<string> => {
  const body = [
    "action=load_more_chapters",
    `nonce=${encodeURIComponent(nonce)}`,
    `comic_id=${encodeURIComponent(comicId)}`,
    `offset=${offset}`,
  ].join("&");

  const [response, data] = await Application.scheduleRequest({
    url: AJAX_ENDPOINT,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
    },
    body,
  });
  if (response.status !== 200) {
    throw new Error(`Chapter request failed with status ${response.status}`);
  }

  let parsed: AjaxChapterResponse;
  try {
    parsed = JSON.parse(Application.arrayBufferToUTF8String(data)) as AjaxChapterResponse;
  } catch (error) {
    throw new Error("Failed to parse the chapter response", { cause: error });
  }

  if (parsed.success !== true) return "";
  return parsed.data?.html ?? "";
};
