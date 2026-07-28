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

import { DOMAIN, type FetchedDocument, type SearchRequest } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;
const JS_REDIRECT_REGEX = /window\.location\.href\s*=\s*["']([^"']+)["']/i;

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
        "accept-language": "en-US,en;q=0.9",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const contentType = response.headers?.["content-type"] ?? response.mimeType ?? "";
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

const siteUrl = (path: string): string => {
  const value = Application.decodeHTMLEntities(path).trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return `${DOMAIN}${value.startsWith("/") ? "" : "/"}${value}`;
};

const resolveUrl = (value: string, baseUrl: string): string => {
  const path = Application.decodeHTMLEntities(value).trim();
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  const origin = baseUrl.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? DOMAIN;
  if (path.startsWith("/")) return `${origin}${path}`;
  const directory = baseUrl.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "/");
  return `${directory}${path}`;
};

const fetchDocument = async (url: string, referer = `${DOMAIN}/`): Promise<FetchedDocument> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { referer },
  });
  if (response.status === 404) throw new Error(`Content not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer), {
    xml: { xmlMode: false, decodeEntities: false },
  });
  if (/^404 Not Found$/i.test($("title").first().text().trim())) {
    throw new Error(`NovelCool returned its not-found page for ${url}.`);
  }
  return { $, url: response.url || url };
};

const followReaderRedirects = async (
  initialUrl: string,
  referer = `${DOMAIN}/`,
): Promise<FetchedDocument> => {
  let page = await fetchDocument(initialUrl, referer);
  const redirect = page
    .$("script")
    .toArray()
    .map((element) => page.$(element).html() ?? "")
    .map((script) => script.match(JS_REDIRECT_REGEX)?.[1])
    .find((value): value is string => Boolean(value));
  if (redirect) {
    const nextUrl = resolveUrl(redirect, page.url);
    page = await fetchDocument(nextUrl, page.url);
  }

  const serverUrl = page.$("a.vision-button[href]").first().attr("href");
  if (serverUrl) {
    const nextUrl = resolveUrl(serverUrl, page.url);
    page = await fetchDocument(nextUrl, page.url);
  }
  return page;
};

const addQueryItem = (url: URL, key: string, value?: string): void => {
  const cleanValue = value?.trim();
  if (cleanValue) url.setQueryItem(key, cleanValue);
};

export const buildCategoryUrl = (path: string, page: number): string => {
  const cleanPath = path.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const pagedPath = page <= 1 ? cleanPath : `${cleanPath.replace(/\.html$/i, "")}_${page}.html`;
  return siteUrl(pagedPath);
};

export const buildSearchUrl = (request: SearchRequest): string => {
  const url = new URL(`${DOMAIN}/search/`).setQueryItem("type", "high");
  addQueryItem(url, "name", request.title);
  if (request.title) addQueryItem(url, "name_method", request.nameMethod ?? "contain");
  addQueryItem(url, "author", request.author);
  if (request.author) addQueryItem(url, "author_method", request.authorMethod ?? "contain");
  addQueryItem(url, "completed_series", request.status);
  if (request.genresInclude?.length) {
    url.setQueryItem("category_id", `,${request.genresInclude.join(",")}`);
  }
  if (request.genresExclude?.length) {
    url.setQueryItem("out_category_id", `,${request.genresExclude.join(",")}`);
  }
  addQueryItem(url, "publish_year", request.year);
  addQueryItem(url, "rate_star", request.rating);
  if (request.page > 1) url.setQueryItem("page", request.page.toString());
  return url.toString();
};

export const fetchHomePage = async (): Promise<cheerio.CheerioAPI> =>
  (await fetchDocument(`${DOMAIN}/`)).$;

export const fetchCategoryPage = async (path: string, page: number): Promise<cheerio.CheerioAPI> =>
  (await fetchDocument(buildCategoryUrl(path, page))).$;

export const fetchSearchPage = async (request: SearchRequest): Promise<cheerio.CheerioAPI> =>
  (await fetchDocument(buildSearchUrl(request))).$;

export const fetchContentPage = async (mangaId: string): Promise<cheerio.CheerioAPI> =>
  (await fetchDocument(siteUrl(decodeURIComponent(mangaId)))).$;

export const fetchChapterPage = (chapterId: string): Promise<FetchedDocument> =>
  followReaderRedirects(siteUrl(decodeURIComponent(chapterId)));

export const fetchReaderPage = (url: string, referer: string): Promise<FetchedDocument> =>
  followReaderRedirects(url, referer);
