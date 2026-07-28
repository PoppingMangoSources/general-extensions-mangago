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

import {
  DESKTOP_USER_AGENT,
  DOMAIN,
  REQUIRED_COOKIES,
  type FetchedDocument,
  type SearchRequest,
} from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;
const JS_REDIRECT_REGEX = /window\.location\.href\s*=\s*["']([^"']+)["']/i;
const URL_SCHEME_REGEX = /^[a-z][a-z0-9+.-]*:/i;

const isHttpUrl = (value: string): boolean => /^https?:\/\/[^/\s]+/i.test(value);

const isNovelCoolUrl = (value: string): boolean => {
  const host = value.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.split(":")[0] ?? "";
  return host === "novelcool.com" || host.endsWith(".novelcool.com");
};

const mergeRequiredCookies = (value: string): string => {
  const cookies = value
    .split(";")
    .map((cookie) => cookie.trim())
    .filter((cookie) => cookie.length > 0 && !/^novelcool_bad_user_\d+=/i.test(cookie));
  const names = new Set(cookies.map((cookie) => cookie.split("=", 1)[0]?.trim().toLowerCase()));
  for (const cookie of REQUIRED_COOKIES) {
    const name = cookie.split("=", 1)[0]?.toLowerCase();
    if (name && !names.has(name)) cookies.push(cookie);
  }
  return cookies.join("; ");
};

export class NovelCoolInterceptor extends PaperbackInterceptor {
  private prepareRequest(request: Request, referer?: string): Request {
    if (!isHttpUrl(request.url)) {
      throw new Error("NovelCool returned an unsupported request URL.");
    }
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    const headers: Record<string, string> = { ...request.headers };
    const cookie = headers.cookie ?? headers.Cookie ?? "";
    delete headers.Cookie;

    return {
      ...request,
      headers: {
        ...headers,
        ...(isNovelCoolUrl(request.url) && { cookie: mergeRequiredCookies(cookie) }),
        referer: referer ?? headers.referer ?? `${DOMAIN}/`,
        "user-agent": DESKTOP_USER_AGENT,
        accept:
          headers.accept ??
          (isImage
            ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
        "accept-language": "en-US,en;q=0.9",
      },
    };
  }

  override async interceptRequest(request: Request): Promise<Request> {
    return this.prepareRequest(request);
  }

  async prepareRedirect(request: Request, response: Response): Promise<Request | undefined> {
    if (!isHttpUrl(request.url)) return undefined;
    const sourceIsReader =
      /\/chapter\//i.test(response.url) ||
      IMAGE_EXTENSION_REGEX.test(response.url) ||
      !isNovelCoolUrl(response.url);
    if (!sourceIsReader && !isNovelCoolUrl(request.url)) return undefined;
    return this.prepareRequest(request, response.url);
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
        headers: { "user-agent": DESKTOP_USER_AGENT },
      });
    }
    return data;
  }
}

const siteUrl = (path: string): string => {
  const value = Application.decodeHTMLEntities(path).trim();
  const url = /^https?:\/\//i.test(value)
    ? value
    : value.startsWith("//")
      ? `https:${value}`
      : URL_SCHEME_REGEX.test(value)
        ? ""
        : `${DOMAIN}${value.startsWith("/") ? "" : "/"}${value}`;
  if (!url || !isNovelCoolUrl(url)) {
    throw new Error("NovelCool returned an unsupported content URL.");
  }
  return url;
};

const resolveUrl = (value: string, baseUrl: string): string => {
  const path = Application.decodeHTMLEntities(value).trim();
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return `https:${path}`;
  if (URL_SCHEME_REGEX.test(path)) return "";
  const origin = baseUrl.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? DOMAIN;
  if (path.startsWith("/")) return `${origin}${path}`;
  const directory = baseUrl.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "/");
  return `${directory}${path}`;
};

const fetchDocument = async (url: string, referer = `${DOMAIN}/`): Promise<FetchedDocument> => {
  if (!isHttpUrl(url)) throw new Error("NovelCool returned an unsupported request URL.");
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
  const finalUrl = response.url || url;
  if (!isHttpUrl(finalUrl)) throw new Error("NovelCool returned an unsupported response URL.");
  return { $, url: finalUrl };
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
    if (nextUrl) page = await fetchDocument(nextUrl, page.url);
  }

  const serverUrl = page.$("a.vision-button[href]").first().attr("href");
  if (serverUrl) {
    const nextUrl = resolveUrl(serverUrl, page.url);
    if (nextUrl) page = await fetchDocument(nextUrl, page.url);
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
