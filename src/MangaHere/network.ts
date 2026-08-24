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

export class MangaHereInterceptor extends PaperbackInterceptor {
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
      cookies: { ...request.cookies, isAdult: "1", MHNMM: "1" },
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

export const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(await fetchText(url));

export const homeUrl = (): string => `${DOMAIN}/`;

export const mobileHomeUrl = (): string => "https://newm.mangahere.cc/";

export const listingUrl = (
  page: number,
  sortToken: string,
  genre?: string,
  status?: string,
): string => {
  const path = [genre, status].filter((value): value is string => Boolean(value)).join("/");
  const base = path ? `${DOMAIN}/${path}/` : `${DOMAIN}/directory/`;
  return `${base}${page > 1 ? `${page}.htm` : ""}?${sortToken}`;
};

export const latestUrl = (page: number): string =>
  page > 1 ? `${DOMAIN}/latest/${page}/` : `${DOMAIN}/latest/`;

export const rankingUrl = (path: string): string => `${DOMAIN}/${path}/`;

export const searchUrl = (page: number, request: SearchRequest): string => {
  const url = new URL(DOMAIN).addPathComponent("search");
  if (page > 1) url.setQueryItem("page", String(page));
  if (request.title) url.setQueryItem("title", request.title);
  if (request.name) {
    url.setQueryItem("name", request.name);
    url.setQueryItem("name_method", request.nameMethod ?? "cw");
  }
  if (request.author) {
    url.setQueryItem("author", request.author);
    url.setQueryItem("author_method", request.authorMethod ?? "cw");
  }
  if (request.artist) {
    url.setQueryItem("artist", request.artist);
    url.setQueryItem("artist_method", request.artistMethod ?? "cw");
  }
  if (request.type) url.setQueryItem("type", request.type);
  if (request.includedGenres?.length) {
    url.setQueryItem("genres", request.includedGenres.join(","));
  }
  if (request.excludedGenres?.length) {
    url.setQueryItem("nogenres", request.excludedGenres.join(","));
  }
  if (request.rating != null) {
    url.setQueryItem("rating", request.rating);
    url.setQueryItem("rating_method", request.ratingMethod ?? "eq");
  }
  if (request.released) {
    url.setQueryItem("released", request.released);
    url.setQueryItem("released_method", request.releasedMethod ?? "eq");
  }
  if (request.completion) url.setQueryItem("st", request.completion);
  if (!request.title) url.setQueryItem("stype", "1");
  return url.toString();
};

export const mangaUrl = (mangaId: string): string => `${DOMAIN}/manga/${mangaId}/`;

export const chapterUrl = (mangaId: string, chapterId: string): string =>
  `${DOMAIN}/manga/${mangaId}/${chapterId}/1.html`;
