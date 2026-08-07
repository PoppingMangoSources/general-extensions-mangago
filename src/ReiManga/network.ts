/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { getBaseUrl } from "./forms";

// One native lookup for the whole session instead of one per request.
let userAgentPromise: Promise<string> | undefined;
const getUserAgent = (): Promise<string> =>
  (userAgentPromise ??= Application.getDefaultUserAgent());

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i;

export class ReiMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);

    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${getBaseUrl()}/`,
        "user-agent": await getUserAgent(),
        "accept-language": "en-US,en;q=0.5",
        accept: isImage
          ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
          : (request.headers?.accept ?? "*/*"),
      },
      // Without this the catalogue silently drops adult entries, so a search
      // that should match returns nothing rather than an age-gated result.
      cookies: { ...request.cookies, showAdultContent: "true" },
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
        headers: { "user-agent": await getUserAgent() },
      });
    }
    return data;
  }
}

const request = async (url: string, headers?: Record<string, string>): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET", headers });

  if (response.status === 404) throw new Error(`Content not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchJson = async <T>(url: string): Promise<T> => {
  const body = await request(url, { accept: "application/json" });
  try {
    return JSON.parse(body) as T;
  } catch (error: unknown) {
    throw new Error(`Failed to parse JSON from ${url}`, { cause: error });
  }
};

// Chapter lists and reader pages live only in the route's server payload, and
// this header asks for that payload instead of the rendered page.
export const fetchFlight = (url: string): Promise<string> =>
  request(url, { rsc: "1", accept: "text/x-component,*/*" });
