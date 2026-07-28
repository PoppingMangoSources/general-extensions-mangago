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
  API_HEADERS,
  API_PARAMETERS,
  API_URL,
  DESKTOP_USER_AGENT,
  DOMAIN,
  PAGE_SIZE,
  REQUIRED_COOKIES,
  type BookInfoResponse,
  type BrowseOrder,
  type BrowseResponse,
  type ChapterInfoResponse,
  type ChapterListResponse,
  type ContentType,
  type SearchRequest,
} from "./models";

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
    const headers = { ...request.headers };
    const cookie = headers.cookie ?? headers.Cookie ?? "";
    delete headers.Cookie;
    return {
      ...request,
      headers: {
        ...headers,
        cookie: mergeRequiredCookies(cookie),
        referer: referer ?? headers.referer ?? `${DOMAIN}/`,
        "user-agent": DESKTOP_USER_AGENT,
        accept:
          headers.accept ??
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    };
  }

  override async interceptRequest(request: Request): Promise<Request> {
    if (request.url.startsWith(API_URL)) return request;
    return this.prepareRequest(request);
  }

  async prepareRedirect(request: Request, response: Response): Promise<Request | undefined> {
    if (!isHttpUrl(request.url) || !isNovelCoolUrl(request.url)) return undefined;
    return this.prepareRequest(request, response.url);
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (!request.url.startsWith(DOMAIN)) return data;
    const contentType = response.headers?.["content-type"] ?? response.mimeType ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 && request.url.startsWith(DOMAIN)) ||
      /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(body)
    ) {
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: request.method ?? "GET",
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
  const host = url.match(/^https?:\/\/([^/?#]+)/i)?.[1]?.split(":")[0] ?? "";
  if (!url || (host !== "novelcool.com" && !host.endsWith(".novelcool.com"))) {
    throw new Error("NovelCool returned an unsupported content URL.");
  }
  return url;
};

const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
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
  return $;
};

const formBody = (parameters: Record<string, string>): string =>
  Object.entries({ ...API_PARAMETERS, ...parameters })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

const fetchApi = async <T extends { error_code: string; error_msg?: string }>(
  path: string,
  parameters: Record<string, string>,
): Promise<T> => {
  const url = `${API_URL}/${path.replace(/^\/+|\/+$/g, "")}/`;
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "POST",
    headers: API_HEADERS,
    body: formBody(parameters),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`NovelCool API request failed with status ${response.status}: ${url}`);
  }

  let data: T;
  try {
    data = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  } catch (error: unknown) {
    throw new Error(`Failed to parse NovelCool API response from ${url}`, { cause: error });
  }
  if (data.error_code !== "success") {
    throw new Error(data.error_msg || `NovelCool API request failed: ${url}`);
  }
  return data;
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
  if (request.title) addQueryItem(url, "name_sel", request.nameMethod ?? "contain");
  addQueryItem(url, "author", request.author);
  if (request.author) addQueryItem(url, "author_sel", request.authorMethod ?? "contain");
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

export const fetchCategoryPage = (path: string, page: number): Promise<cheerio.CheerioAPI> =>
  fetchDocument(buildCategoryUrl(path, page));

export const fetchSearchPage = (request: SearchRequest): Promise<cheerio.CheerioAPI> =>
  fetchDocument(buildSearchUrl(request));

export const fetchUrlPage = (url: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(siteUrl(url));

export const fetchBrowse = (
  order: BrowseOrder,
  contentType: ContentType,
  page: number,
): Promise<BrowseResponse> =>
  fetchApi<BrowseResponse>(`elite/${order}`, {
    lc_type: contentType,
    page: page.toString(),
    page_size: PAGE_SIZE.toString(),
  });

export const fetchBookSearch = (
  query: string,
  contentType: ContentType,
  page: number,
): Promise<BrowseResponse> =>
  fetchApi<BrowseResponse>("book/search", {
    keyword: query,
    lc_type: contentType,
    page: page.toString(),
    page_size: PAGE_SIZE.toString(),
  });

export const fetchBookInfo = (bookId: string): Promise<BookInfoResponse> =>
  fetchApi<BookInfoResponse>("book/info", { book_id: bookId });

export const fetchBookChapters = (bookId: string): Promise<ChapterListResponse> =>
  fetchApi<ChapterListResponse>("chapter/book_list", { book_id: bookId });

export const fetchChapterInfo = (chapterId: string): Promise<ChapterInfoResponse> =>
  fetchApi<ChapterInfoResponse>("chapter/info", { chapter_id: chapterId });
