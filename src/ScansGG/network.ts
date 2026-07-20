/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { getApiUrl, getDomain } from "./forms/settings";
import { USER_AGENT, type ResponseDto } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

export class ScansGGInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const domain = getDomain();
    const isApi = request.url.startsWith(getApiUrl());
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);

    // Match what a real browser sends for each request class: XHR-style JSON
    // headers for the API, a navigation accept for site documents, and an
    // image accept for CDN images. A mismatched accept — or an Origin header
    // on a plain document GET, which browsers never send — reads as bot
    // traffic and gets the connection held open until it drops.
    const accept = isApi
      ? "application/json, text/plain, */*"
      : isImage
        ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

    const headers: Record<string, string> = {
      ...request.headers,
      referer: `${domain}/`,
      "user-agent": USER_AGENT,
      accept,
      "accept-language": "en-US,en;q=0.5",
    };
    // Browsers only attach Origin to cross-origin requests (the API).
    if (isApi) headers.origin = domain;

    return { ...request, headers };
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

/** A single query value; arrays are joined into the `[a,b,c]` form the API uses. */
export type QueryValue = string | number | boolean | string[];

/**
 * GET a JSON endpoint under the API host and return its `data` payload.
 * Query values are appended in insertion order; `undefined` values are skipped.
 */
export async function fetchApi<T>(
  path: string,
  query: Record<string, QueryValue | undefined> = {},
): Promise<ResponseDto<T>> {
  const builder = new URL(getApiUrl()).addPathComponent(path);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const serialized = Array.isArray(value) ? `[${value.join(",")}]` : String(value);
    builder.setQueryItem(key, serialized);
  }
  const url = builder.toString();

  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  const text = Application.arrayBufferToUTF8String(buffer);
  try {
    return JSON.parse(text) as ResponseDto<T>;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${reason}`);
  }
}
