/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { getBaseUrl } from "./forms";

// One native lookup for the whole session instead of one per request.
let userAgentPromise: Promise<string> | undefined;
const getUserAgent = (): Promise<string> =>
  (userAgentPromise ??= Application.getDefaultUserAgent());

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

export class MangaBerriInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
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
