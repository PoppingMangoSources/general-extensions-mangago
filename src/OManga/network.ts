/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { type CatalogQuery, type CatalogResponse, getDomain } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

export const buildCatalogUrl = (query: CatalogQuery): string => {
  const url = new URL(getDomain()).addPathComponent("api").addPathComponent("catalog");
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const values = (Array.isArray(value) ? value : [value]).filter(Boolean);
    if (values.length > 0) url.setQueryItem(key, values);
  }
  return url.toString();
};

export const fetchCatalog = async (query: CatalogQuery): Promise<CatalogResponse> => {
  const url = buildCatalogUrl(query);
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Catalog request failed with status ${response.status}: ${url}`);
  }

  try {
    const result = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as CatalogResponse;
    if (!Array.isArray(result.items)) throw new Error("Catalog response has no items array");
    return result;
  } catch (error) {
    throw new Error("Failed to parse the catalog response", { cause: error });
  }
};

export class OMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);

    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${getDomain()}/`,
        "user-agent": await Application.getDefaultUserAgent(),
        accept:
          request.headers?.accept ??
          (isImage
            ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
        "accept-language": "en-US,en;q=0.9",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 && request.url.startsWith(getDomain()));
    if (challenged) {
      throw new CloudflareError({
        url: `${getDomain()}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

export const fetchHtmlPage = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  return Application.arrayBufferToUTF8String(buffer);
};
export const fetchFlightPayload = async (
  url: string,
  headers: Record<string, string> = {},
): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { accept: "text/x-component", ...headers, rsc: "1" },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Payload request failed with status ${response.status}: ${url}`);
  }

  return Application.arrayBufferToUTF8String(buffer);
};

export const buildSeriesNavigationHeaders = (slug: string): Record<string, string> => {
  const page = ["__PAGE__", {}, null, "refetch"];
  const tab = [["tab", "", "oc", null], { children: page }, null, null, 4];
  const series = [["slug", slug, "d", null], { children: tab }, null, null, 8];
  const manga = ["manga", { children: series }, null, null, 8];
  const routerState = ["", { children: manga }, null, null, 28];

  return {
    "next-router-state-tree": encodeURIComponent(JSON.stringify(routerState)),
    "next-url": `/manga/${slug}`,
  };
};

export const fetchPagePayload = async (
  url: string,
  requiredMarker: string,
  headers?: Record<string, string>,
): Promise<string> => {
  try {
    const payload = await fetchFlightPayload(url, headers);
    if (payload.includes(requiredMarker)) return payload;
  } catch (error) {
    if (error instanceof CloudflareError) throw error;
  }
  return fetchHtmlPage(url);
};
