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
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  return new URL(DOMAIN).setPath(path).toString();
};

export const buildCategoryUrl = (path: string, page: number): string => {
  if (page <= 1) return absoluteUrl(path);
  const withoutHtml = path.replace(/\.html$/i, "");
  return absoluteUrl(`${withoutHtml}_${page}.html`);
};

export const buildSearchUrl = (request: SearchRequest): string => {
  const url = new URL(DOMAIN).addPathComponent("search");
  if (request.title) url.setQueryItem("name", request.title);
  if (request.author) url.setQueryItem("author", request.author);
  if (request.status) url.setQueryItem("completed_series", request.status);
  if (request.genresInclude?.length) {
    url.setQueryItem("category_id", `,${request.genresInclude.join(",")}`);
  }
  if (request.genresExclude?.length) {
    url.setQueryItem("out_category_id", `,${request.genresExclude.join(",")}`);
  }
  if (request.type) url.setQueryItem("type", request.type);
  if (request.year) url.setQueryItem("year", request.year);
  if (request.alphabet) url.setQueryItem("alphabet", request.alphabet);
  if (request.sort && request.sort !== "index") url.setQueryItem("sort", request.sort);
  if (request.page > 1) url.setQueryItem("page", request.page.toString());
  return url.toString();
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
