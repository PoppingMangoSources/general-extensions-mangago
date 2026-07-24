/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { API_URL, DOMAIN } from "./models";

export class NovelArchiveInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // Keep image requests untouched apart from the user agent — extra headers
    // on cover fetches slow the CDN's responses down.
    const isApi = request.url.startsWith(API_URL);
    return {
      ...request,
      headers: {
        ...request.headers,
        "user-agent": await Application.getDefaultUserAgent(),
        ...(isApi
          ? {
              referer: `${DOMAIN}/`,
              origin: DOMAIN,
              accept: "application/json, text/plain, */*",
              "accept-language": "en-US,en;q=0.5",
            }
          : {}),
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

const CACHE_TTL = 60_000;
const cache = new Map<string, { expires: number; value: Promise<unknown> }>();

const requestJSON = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  const body = Application.arrayBufferToUTF8String(buffer);
  try {
    return JSON.parse(body) as T;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${reason}`, { cause: error });
  }
};

export const fetchJSON = <T>(url: string): Promise<T> => {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expires > now) return cached.value as Promise<T>;

  const value = requestJSON<T>(url);
  cache.set(url, { expires: now + CACHE_TTL, value });
  value.catch(() => {
    if (cache.get(url)?.value === value) cache.delete(url);
  });
  return value;
};
