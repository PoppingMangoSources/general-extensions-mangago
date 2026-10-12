/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import {
  DOMAIN,
  PAGE_SIZE,
  type FacetsResponse,
  type LatestResponse,
  type SeriesListResponse,
  type SeriesResponse,
} from "./models";
import { decodeBase64Url, decryptPage } from "./utils";

// Encrypted page urls carry their key and nonce after "#" so the interceptor can decrypt the
// response; the fragment is never sent to the server.
const PAGE_KEY_MARKER = "#tk=";

export const encodePageUrl = (src: string, key: string, nonce: string): string =>
  `${src}${PAGE_KEY_MARKER}${key}.${nonce}`;

const IMAGE_REGEX = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

export class ToonkotsuInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isApi = /\/(?:api|cdn\/v1)\//.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        accept: isApi
          ? "application/json"
          : IMAGE_REGEX.test(request.url) || request.url.includes(PAGE_KEY_MARKER)
            ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(isApi && { origin: DOMAIN }),
        referer: `${DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      // The API answers in JSON and cannot display the challenge; solving it on the site clears
      // the whole domain.
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    const markerIndex = request.url.indexOf(PAGE_KEY_MARKER);
    if (markerIndex < 0 || response.status < 200 || response.status >= 300) return data;
    const [key = "", nonce = ""] = request.url
      .slice(markerIndex + PAGE_KEY_MARKER.length)
      .split(".");
    try {
      return decryptPage(data, decodeBase64Url(key), decodeBase64Url(nonce).subarray(0, 8));
    } catch (error) {
      throw new Error(`Could not decrypt page ${request.url.slice(0, markerIndex)}`, {
        cause: error,
      });
    }
  }
}

interface RequestInit {
  body?: unknown;
  headers?: Record<string, string>;
}

const requestJson = async (url: string, init?: RequestInit) => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: init?.body === undefined ? "GET" : "POST",
    headers: {
      ...init?.headers,
      ...(init?.body !== undefined && { "content-type": "application/json" }),
    },
    ...(init?.body !== undefined && { body: JSON.stringify(init.body) }),
  });
  const ok = response.status >= 200 && response.status < 300;
  try {
    return {
      status: response.status,
      data: JSON.parse(Application.arrayBufferToUTF8String(buffer)) as unknown,
    };
  } catch (error) {
    if (!ok)
      throw new Error(`Request failed with status ${response.status}: ${url}`, { cause: error });
    throw new Error(`Invalid response from ${url}`, { cause: error });
  }
};

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const { status, data } = await requestJson(url, init);
  if (status === 404) throw new Error(`Not found: ${url}`);
  if (status < 200 || status >= 300)
    throw new Error(`Request failed with status ${status}: ${url}`);
  return data as T;
};

export type CatalogueParams = Record<string, string | number | boolean | undefined>;

// The site skips empty and false parameters and sends true as "1".
const siteUrl = (path: string, params: CatalogueParams) => {
  const url = new URL(DOMAIN);
  for (const segment of path.split("/")) url.addPathComponent(segment);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === false) continue;
    url.setQueryItem(key, value === true ? "1" : String(value));
  }
  return url.toString();
};

export const fetchBrowse = (params: CatalogueParams): Promise<SeriesListResponse> =>
  fetchJson(siteUrl("cdn/v1/browse", { limit: PAGE_SIZE, ...params }));

export const fetchLatest = (page: number, params: CatalogueParams): Promise<LatestResponse> =>
  fetchJson(siteUrl("cdn/v1/latest", { ...params, page, limit: PAGE_SIZE }));

// Rankings built from this site's own readers are served by the site, not the catalogue. Discovery
// rankings are posted as the browse parameters; reading counts are read with a query string.
export const fetchDiscoveryRanking = (
  metric: string,
  params: CatalogueParams,
): Promise<SeriesListResponse> =>
  fetchJson(`${DOMAIN}/api/v1/rankings`, {
    body: { params: { limit: PAGE_SIZE, ...params, discovery: metric, metric } },
  });

export const fetchReadingRanking = (
  metric: string,
  params: CatalogueParams,
): Promise<SeriesListResponse> =>
  fetchJson(siteUrl("api/v1/rankings", { limit: PAGE_SIZE, ...params, metric }));

export const fetchFacets = (): Promise<FacetsResponse> =>
  fetchJson(siteUrl("cdn/v1/facets", { sfw: false }));

export const fetchSeries = (mangaId: string): Promise<SeriesResponse> =>
  fetchJson(siteUrl(`cdn/v1/series/${mangaId}`, {}));

// The reader answers its reading limit with a 429 whose body says how to recover, so these return
// the status alongside the body.
export const requestReaderKey = () => requestJson(`${DOMAIN}/api/manga/key`);

export const fetchReaderPage = async (chapterId: string): Promise<string> => {
  const url = `${DOMAIN}/chapter/${chapterId}`;
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Could not fetch the reader configuration (status ${response.status}).`);
  return Application.arrayBufferToUTF8String(buffer);
};

export const requestChapter = (path: string, signature: string) =>
  requestJson(`${DOMAIN}${path}`, { headers: { "x-sig": signature } });
