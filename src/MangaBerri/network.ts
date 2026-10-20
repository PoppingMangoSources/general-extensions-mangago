/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { PaperbackInterceptor, URL, type Request, type Response } from "@paperback/types";

import { getBaseUrl } from "./forms";
import type { BrowseQuery } from "./models";

// One native lookup for the whole session instead of one per request.
let userAgentPromise: Promise<string> | undefined;
const getUserAgent = (): Promise<string> =>
  (userAgentPromise ??= Application.getDefaultUserAgent());

// Covers and pages are served from /media/source/ without an extension.
const IMAGE_REGEX = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)|\/media\/source\//i;

export class MangaBerriInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_REGEX.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${getBaseUrl()}/`,
        "user-agent": await getUserAgent(),
        "accept-language": "en-US,en;q=0.9",
        accept: isImage
          ? "image/avif,image/webp,image/apng,image/png,image/*,*/*;q=0.8"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    };
  }

  override async interceptResponse(
    _request: Request,
    _response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    return data;
  }
}

export const fetchHtml = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  return Application.arrayBufferToUTF8String(buffer);
};

// The browse page lists every title, filtered and sorted as its own form asks.
export const browseUrl = (query: BrowseQuery, page: number): string => {
  const url = new URL(`${getBaseUrl()}/browse`);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.setQueryItem(key, value);
  }
  if (page > 1) url.setQueryItem("page", String(page));
  return url.toString();
};
