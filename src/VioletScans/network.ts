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

import { DOMAIN, type ChapterUpdateKind } from "./models";

const IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[/?#]|$)/i;

export class VioletScansInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION.test(request.url);
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

export const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) throw new Error(`Content not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return cheerio.load(Application.arrayBufferToUTF8String(buffer));
};

type CatalogRequest = {
  page?: number;
  title?: string;
  genres?: string[];
  status?: string;
  type?: string;
  order?: string;
};

const buildCatalogUrl = (request: CatalogRequest): string => {
  const url = new URL(`${DOMAIN}/comics/`);
  if (request.page && request.page > 1) url.setQueryItem("page", request.page.toString());
  if (request.title) url.setQueryItem("s", request.title);
  if (request.genres?.length) url.setQueryItem("genre[]", request.genres);
  if (request.status) url.setQueryItem("status", request.status);
  if (request.type) url.setQueryItem("type", request.type);
  if (request.order) url.setQueryItem("order", request.order);
  return url.toString();
};

export const fetchCatalogPage = (request: CatalogRequest): Promise<cheerio.CheerioAPI> =>
  fetchDocument(buildCatalogUrl(request));

export const fetchChapterUpdatesPage = async (
  kind: ChapterUpdateKind,
  page: number,
  initialOrganicCount: number,
  displayedPinIds: string,
): Promise<cheerio.CheerioAPI> => {
  const body = [
    `action=${kind === "comics" ? "load_more_manga_posts" : "violet_load_more_novels"}`,
    `page=${page}`,
    `violet_initial_organic_count=${initialOrganicCount}`,
    `violet_displayed_pin_ids=${encodeURIComponent(displayedPinIds)}`,
  ].join("&");
  const url = `${DOMAIN}/wp-admin/admin-ajax.php`;
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
    },
    body,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return cheerio.load(Application.arrayBufferToUTF8String(buffer));
};

export const fetchMangaPage = (mangaId: string): Promise<cheerio.CheerioAPI> => {
  const url = new URL(`${DOMAIN}/comics/`).addPathComponent(mangaId).toString();
  return fetchDocument(url.endsWith("/") ? url : `${url}/`);
};

export const fetchChapterPage = (chapterId: string): Promise<cheerio.CheerioAPI> => {
  const url = new URL(`${DOMAIN}/`).addPathComponent(chapterId).toString();
  return fetchDocument(url.endsWith("/") ? url : `${url}/`);
};
