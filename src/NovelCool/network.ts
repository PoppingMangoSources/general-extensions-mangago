/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { DOMAIN, type SearchRequest } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;

export class NovelCoolInterceptor extends PaperbackInterceptor {
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
      (response.status === 403 && request.url.startsWith(DOMAIN)) ||
      /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(body)
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

const absoluteUrl = (path: string): string => {
  const value = Application.decodeHTMLEntities(path).trim();
  if (!value) return `${DOMAIN}/`;
  if (/^https?:\/\//i.test(value)) return encodeURI(value);
  if (value.startsWith("//")) return encodeURI(`https:${value}`);
  return encodeURI(`${DOMAIN}${value.startsWith("/") ? "" : "/"}${value}`);
};

const addQueryItem = (query: string[], key: string, value?: string): void => {
  const cleanValue = value?.trim();
  if (cleanValue) query.push(`${encodeURIComponent(key)}=${encodeURIComponent(cleanValue)}`);
};

export const buildCategoryUrl = (path: string, page: number): string => {
  const cleanPath = path.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (page <= 1) return absoluteUrl(cleanPath);
  return absoluteUrl(`${cleanPath.replace(/\.html$/i, "")}_${page}.html`);
};

export const buildSearchUrl = (request: SearchRequest): string => {
  const query = ["type=high"];
  addQueryItem(query, "name", request.title);
  addQueryItem(query, "name_method", request.nameMethod);
  addQueryItem(query, "author", request.author);
  addQueryItem(query, "author_method", request.authorMethod);
  if (request.status && request.status !== "0") addQueryItem(query, "completed_series", request.status);
  if (request.genresInclude?.length) addQueryItem(query, "category_id", `,${request.genresInclude.join(",")}`);
  if (request.genresExclude?.length) addQueryItem(query, "out_category_id", `,${request.genresExclude.join(",")}`);
  addQueryItem(query, "publish_year", request.year);
  addQueryItem(query, "rate", request.rating);
  if (request.sort && request.sort !== "index") addQueryItem(query, "sort", request.sort);
  if (request.page > 1) addQueryItem(query, "page", request.page.toString());
  return `${DOMAIN}/search/?${query.join("&")}`;
};

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchCheerio(`${DOMAIN}/`);

export const fetchCategoryPage = (path: string, page: number): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(buildCategoryUrl(path, page));

export const fetchSearchPage = (request: SearchRequest): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(buildSearchUrl(request));

export const fetchContentPage = (id: string): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(absoluteUrl(decodeURIComponent(id)));

export const fetchChapterPage = (chapterId: string): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(absoluteUrl(decodeURIComponent(chapterId)));
