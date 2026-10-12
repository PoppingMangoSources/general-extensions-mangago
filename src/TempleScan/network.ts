/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Cookie,
  type Request,
  type Response,
} from "@paperback/types";

import { API_URL, DECODE_RSC_KEYS, DOMAIN, RSC_FIELDS, type RscTable } from "./models";

export class TempleScanInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // Some covers live on third-party hosts whose hotlink protection swaps in
    // a placeholder when a foreign referer is attached; only claim the site
    // as referer on its own hosts. Cloudflare blocks requests that carry an
    // Origin header, so never send one.
    const firstParty = /^https:\/\/(?:[a-z0-9-]+\.)*templetoons\.com\//i.test(request.url);

    return {
      ...request,
      headers: {
        ...request.headers,
        ...(firstParty ? { referer: `${DOMAIN}/` } : {}),
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
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

// Without this an error body reaches the flight parser as "no series data".
const assertOk = (url: string, status: number): void => {
  if (status === 404) throw new Error(`Content not found: ${url}`);
  if (status < 200 || status >= 300) {
    throw new Error(`Request failed with status ${status}: ${url}`);
  }
};

// Routes are Next.js App Router pages; the `rsc` header returns the flight
// stream carrying the page's data instead of the rendered HTML shell.
const fetchRsc = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { rsc: "1" },
  });
  assertOk(url, response.status);
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchDirectory = (): Promise<string> => fetchRsc(`${DOMAIN}/comics`);

export const fetchHomePage = (): Promise<string> => fetchRsc(`${DOMAIN}/`);

export const fetchSeriesPage = (mangaId: string): Promise<string> =>
  fetchRsc(`${DOMAIN}/comic/${mangaId}`);

export const fetchChapterPage = (mangaId: string, chapterId: string): Promise<string> =>
  fetchRsc(`${DOMAIN}/comic/${mangaId}/${chapterId}`);

const fetchApi = async (path: string): Promise<string> => {
  const url = `${API_URL}${path}`;
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  assertOk(url, response.status);
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchFeatured = (): Promise<string> => fetchApi("/banners");

export const fetchTrending = (): Promise<string> => fetchApi("/topSeries");

// The rendered HTML (not the flight stream) carries the <script src> chunk list needed to find the
// site's key decoder.
export const fetchHtml = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  assertOk(url, response.status);
  return Application.arrayBufferToUTF8String(buffer);
};

// Runs the site's own key-rename function in a WebView to recover the {logical: short} table.
// A blank page on the site's origin lets same-origin chunk fetches carry the clearance cookie.
export const decodeRscTable = async (
  chunks: string[],
  keys: string[],
  cookies: Cookie[],
): Promise<RscTable | null> => {
  const userAgent = await Application.getDefaultUserAgent();
  const inject =
    `return (${DECODE_RSC_KEYS})(` +
    `${JSON.stringify(chunks)}, ${JSON.stringify(keys)}, ${JSON.stringify(RSC_FIELDS)});`;
  const { result } = await Application.executeInWebView({
    source: {
      html: "<!doctype html><html><head></head><body></body></html>",
      baseUrl: `${DOMAIN}/`,
      loadCSS: false,
      loadImages: false,
      userAgent,
    },
    inject,
    storage: { cookies },
  });
  return result && typeof result === "object" && !Array.isArray(result)
    ? (result as RscTable)
    : null;
};
