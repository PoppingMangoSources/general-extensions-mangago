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

import { DOMAIN, type ChapterAjaxResponse, type SearchRequest } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;

const decodePathId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export class LikeMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
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
    // Only read the interstitial markers out of a blocked response; a synopsis
    // can contain "Just a moment" of its own.
    const blocked =
      request.url.startsWith(DOMAIN) && (response.status === 403 || response.status === 503);
    const contentType = response.headers?.["content-type"] ?? "";
    const body =
      blocked && contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      (blocked && /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(body))
    ) {
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

export const fetchCheerio = async (url: string): Promise<cheerio.CheerioAPI> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) throw new Error(`Content not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return cheerio.load(Application.arrayBufferToUTF8String(buffer), {
    xml: { xmlMode: false, decodeEntities: false },
  });
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  try {
    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${reason}`, { cause: error });
  }
};

export const buildSearchUrl = (request: SearchRequest): string => {
  const url = new URL(DOMAIN).setQueryItem("act", "searchadvance");
  if (request.keyword) url.setQueryItem("f[keyword]", request.keyword);
  if (request.sortBy) url.setQueryItem("f[sortby]", request.sortBy);
  if (request.status) url.setQueryItem("f[status]", decodePathId(request.status));
  if (request.genres?.length) {
    url.setQueryItem("f[genres][]", request.genres.map(decodePathId));
  }
  if (request.minChapters && request.minChapters !== "1") {
    url.setQueryItem("f[min_num_chapter]", request.minChapters);
  }
  if (request.page > 1) url.setQueryItem("pageNum", request.page.toString());
  return url.toString();
};

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchCheerio(`${DOMAIN}/`);

export const fetchAdvancedSearchPage = (): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(`${DOMAIN}/searchadvance/`);

export const fetchSearchPage = (request: SearchRequest): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(buildSearchUrl(request));

export const fetchContentPage = (id: string): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(new URL(DOMAIN).setPath(decodePathId(id)).toString());

export const fetchChapterListPage = async (
  mangaNumericId: string,
  page: number,
): Promise<string> => {
  const response = await fetchJson<ChapterAjaxResponse>(
    new URL(DOMAIN)
      .setQueryItem("act", "ajax")
      .setQueryItem("code", "load_list_chapter")
      .setQueryItem("manga_id", mangaNumericId)
      .setQueryItem("page_num", page.toString())
      .setQueryItem("chap_id", "0")
      .setQueryItem("keyword", "")
      .toString(),
  );
  if (typeof response.list_chap !== "string") {
    throw new Error(`Invalid chapter list response for manga ${mangaNumericId}, page ${page}.`);
  }
  return response.list_chap;
};
