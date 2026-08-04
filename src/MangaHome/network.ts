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

export class MangaHomeInterceptor extends PaperbackInterceptor {
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

export const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(await fetchText(url));

// Listing tabs order results with a bare query key (e.g. ?rating.za), so sort
// tokens are appended verbatim instead of as key=value pairs.
export const listingUrl = (path: string, page: number, sortToken?: string): string => {
  const base = page > 1 ? `${DOMAIN}/${path}/${page}.html` : `${DOMAIN}/${path}`;
  return sortToken ? `${base}?${sortToken}` : base;
};

export const rankUrl = (): string => `${DOMAIN}/rank`;

export const homeUrl = (): string => `${DOMAIN}/`;

export const searchUrl = (page: number, request: SearchRequest): string => {
  const url = new URL(DOMAIN).addPathComponent("search");
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
    url.setQueryItem("ingenres", request.includedGenres.join(","));
  }
  if (request.excludedGenres?.length) {
    url.setQueryItem("exgenres", request.excludedGenres.join(","));
  }
  if (request.released) {
    url.setQueryItem("released", request.released);
    url.setQueryItem("released_method", request.releasedMethod ?? "eq");
  }
  if (request.rating) {
    url.setQueryItem("rating", request.rating);
    url.setQueryItem("rating_method", request.ratingMethod ?? "eq");
  }
  if (request.isCompleted) url.setQueryItem("is_completed", request.isCompleted);
  // The form always submits this flag; without it the server ignores the
  // advanced fields and falls back to a plain name search.
  url.setQueryItem("advopts", "1");
  if (page > 1) url.setQueryItem("page", String(page));
  return url.toString();
};

export const mangaUrl = (mangaId: string): string => `${DOMAIN}/manga/${mangaId}/`;

export const chapterUrl = (mangaId: string, chapterId: string): string =>
  `${DOMAIN}/manga/${mangaId}/${chapterId}/`;
