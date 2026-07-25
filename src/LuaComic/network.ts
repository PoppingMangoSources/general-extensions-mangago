/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { API_URL, DOMAIN, type LuaTag, type OptionItem } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

export class LuaComicInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const accept = IMAGE_EXTENSION_REGEX.test(request.url)
      ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
      : "application/json, text/html, */*";

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
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

export const fetchJSON = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status === 404) throw new Error(`Content not found: ${url}`);
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

export const fetchText = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

// The tags endpoint has historically returned an empty list; callers fall back to static genres.
export const fetchTags = async (): Promise<OptionItem[]> => {
  const url = new URL(API_URL).addPathComponent("tags").toString();
  const raw = await fetchJSON<LuaTag[] | { data?: LuaTag[] }>(url);
  const tags = Array.isArray(raw) ? raw : (raw.data ?? []);
  return tags
    .filter((tag): tag is LuaTag => Boolean(tag?.name && tag.id != null))
    .map((tag) => ({ id: String(tag.id), value: String(tag.name).trim() }));
};
