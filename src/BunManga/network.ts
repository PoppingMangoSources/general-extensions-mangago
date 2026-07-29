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

export class BunMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: request.headers?.referer ?? `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
        accept:
          request.headers?.accept ??
          (isImage
            ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
        "accept-language": "en-US,en;q=0.5",
      },
      cookies: {
        ...request.cookies,
        "toonily-mature": "1",
        "wpmanga-adault": "1",
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
      (response.status === 403 && /(?:Just a moment|cf-chl-|_cf_chl_opt|g-recaptcha)/i.test(body))
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

const postText = async (url: string, body: string, referer: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      referer,
      "x-requested-with": "XMLHttpRequest",
    },
    body,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(await fetchText(url));

const toFormValue = (value: string): string => encodeURIComponent(value).replace(/%20/g, "+");

const appendFormValues = (entries: string[], key: string, value: unknown): void => {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValues(entries, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendFormValues(entries, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return;
  }
  entries.push(`${toFormValue(key)}=${toFormValue(String(value))}`);
};

const loadMoreBody = (page: number, queryVars: string): string => {
  let variables: unknown;
  try {
    variables = JSON.parse(queryVars);
  } catch (error: unknown) {
    throw new Error("Unable to parse BunManga pagination metadata.", { cause: error });
  }
  if (!variables || typeof variables !== "object" || Array.isArray(variables)) {
    throw new Error("Invalid BunManga pagination metadata.");
  }

  const entries = [
    `action=${toFormValue("madara_load_more")}`,
    `page=${page}`,
    `template=${toFormValue("madara-core/content/content-search")}`,
  ];
  appendFormValues(entries, "vars", variables);
  return entries.join("&");
};

export const buildSearchUrl = (request: SearchRequest): string => {
  const url = new URL(request.title ? DOMAIN : `${DOMAIN}/?s`).setQueryItem(
    "post_type",
    "wp-manga",
  );
  if (request.title) url.setQueryItem("s", request.title);
  if (request.sortBy && request.sortBy !== "relevance") {
    url.setQueryItem("m_orderby", request.sortBy);
  }
  if (request.genres?.length) url.setQueryItem("genre[]", request.genres);
  if (request.genreMatch === "and") url.setQueryItem("op", "1");
  if (request.author) url.setQueryItem("author", request.author);
  if (request.artist) url.setQueryItem("artist", request.artist);
  if (request.releaseYear) url.setQueryItem("release", request.releaseYear);
  if (request.adult && request.adult !== "all") url.setQueryItem("adult", request.adult);
  if (request.statuses?.length) url.setQueryItem("status[]", request.statuses);
  return url.toString();
};

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchDocument(`${DOMAIN}/`);

export const fetchSearchPage = (request: SearchRequest): Promise<cheerio.CheerioAPI> =>
  fetchDocument(buildSearchUrl(request));

export const fetchLoadMorePage = async (
  page: number,
  queryVars: string,
  referer: string,
): Promise<cheerio.CheerioAPI> =>
  cheerio.load(
    await postText(`${DOMAIN}/wp-admin/admin-ajax.php`, loadMoreBody(page, queryVars), referer),
  );

export const fetchMangaPage = (mangaId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(new URL(DOMAIN).addPathComponent("manga").addPathComponent(mangaId).toString());

export const fetchChapterList = async (mangaId: string): Promise<cheerio.CheerioAPI> => {
  const url = new URL(DOMAIN)
    .addPathComponent("manga")
    .addPathComponent(mangaId)
    .addPathComponent("ajax")
    .addPathComponent("chapters")
    .toString();
  return cheerio.load(await postText(url, "", `${DOMAIN}/manga/${mangaId}/`));
};

export const fetchReaderPage = (mangaId: string, chapterId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(
    new URL(DOMAIN)
      .addPathComponent("manga")
      .addPathComponent(mangaId)
      .addPathComponent(chapterId)
      .setQueryItem("style", "list")
      .toString(),
  );
