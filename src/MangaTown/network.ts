/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { DOMAIN, type DirectoryFilters, type SearchRequest } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;

export class MangaTownInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: request.headers?.referer ?? `${DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
        accept:
          request.headers?.accept ??
          (isImage
            ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
        "accept-language": "en-US,en;q=0.5",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const contentType = response.headers?.["content-type"] ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 && /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(body))
    ) {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

const fetchText = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) throw new Error(`Content not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(await fetchText(url));

// The site's listing tabs order results with a bare query key (e.g. ?rating.za),
// so sort tokens are appended verbatim instead of as key=value pairs.
const withSortToken = (url: string, token?: string): string => (token ? `${url}?${token}` : url);

export const directoryUrl = (page: number, filters: DirectoryFilters = {}): string =>
  withSortToken(
    `${DOMAIN}/directory/${filters.demographic ?? "0"}-${filters.genre ?? "0"}-0-${
      filters.status ?? "0"
    }-0-0/${page}.htm`,
    filters.sortToken,
  );

export const hotUrl = (page: number, demographic?: string, sortToken?: string): string =>
  withSortToken(`${DOMAIN}/hot/${demographic ? `${demographic}/` : ""}${page}.htm`, sortToken);

export const searchUrl = (page: number, request: SearchRequest): string => {
  const url = new URL(DOMAIN).addPathComponent("search").setQueryItem("page", String(page));
  if (request.name) url.setQueryItem("name", request.name);
  if (request.author) url.setQueryItem("author", request.author);
  if (request.artist) url.setQueryItem("artist", request.artist);
  const included = [...(request.includedGenres ?? [])];
  if (request.demographic) included.push(request.demographic);
  for (const genre of included) url.setQueryItem(`genres[${genre}]`, "1");
  for (const genre of request.excludedGenres ?? []) url.setQueryItem(`genres[${genre}]`, "2");
  if (request.isCompleted) url.setQueryItem("is_completed", request.isCompleted);
  return url.toString();
};

export const mangaUrl = (mangaId: string): string => `${DOMAIN}/manga/${mangaId}/`;

export const chapterUrl = (mangaId: string, chapterId: string): string =>
  `${DOMAIN}/manga/${mangaId}/${chapterId}/`;

export const fetchListingPage = (url: string): Promise<cheerio.CheerioAPI> => fetchDocument(url);

export const fetchFeaturedPage = (): Promise<cheerio.CheerioAPI> =>
  fetchDocument(`${DOMAIN}/featured/`);

export const fetchMangaPage = (mangaId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(mangaUrl(mangaId));

export const fetchChapterPage = (url: string): Promise<cheerio.CheerioAPI> => fetchDocument(url);
