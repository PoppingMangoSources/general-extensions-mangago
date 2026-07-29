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

import { DOMAIN, MANGA_DIR } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;

export class GalaxyMangaInterceptor extends PaperbackInterceptor {
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

export interface DirectoryRequest {
  title?: string;
  order?: string;
  statuses?: string[];
  types?: string[];
  includedGenres?: string[];
  excludedGenres?: string[];
}

export const directoryUrl = (page: number, request: DirectoryRequest = {}): string => {
  const url = new URL(DOMAIN).addPathComponent(`${MANGA_DIR}/`).setQueryItem("page", String(page));
  if (request.title) url.setQueryItem("title", request.title);
  if (request.order) url.setQueryItem("order", request.order);
  if (request.statuses?.[0]) url.setQueryItem("status", request.statuses[0]);
  if (request.types?.[0]) url.setQueryItem("type", request.types[0]);
  const genres = [
    ...(request.includedGenres ?? []),
    ...(request.excludedGenres ?? []).map((slug) => `-${slug}`),
  ];
  if (genres.length > 0) url.setQueryItem("genre[]", genres);
  return url.toString();
};

export const mangaUrl = (mangaId: string): string => `${DOMAIN}/${MANGA_DIR}/${mangaId}/`;

export const chapterUrl = (chapterId: string): string => `${DOMAIN}/${chapterId}/`;

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchDocument(`${DOMAIN}/`);

export const fetchDirectoryPage = (
  page: number,
  request: DirectoryRequest = {},
): Promise<cheerio.CheerioAPI> => fetchDocument(directoryUrl(page, request));

export const fetchMangaPage = (mangaId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(mangaUrl(mangaId));

export const fetchChapterPage = (chapterId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(chapterUrl(chapterId));
