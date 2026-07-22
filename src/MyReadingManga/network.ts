/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { DOMAIN, LANGUAGES, TAXONOMIES, type SearchMetadata } from "./models";

export class MyReadingMangaInterceptor extends PaperbackInterceptor {
  private challengeThrownAt = 0;

  clearChallenge(): void {
    this.challengeThrownAt = 0;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge" || response.status === 403) {
      // Discover fires every section at once; queue a single bypass request
      // per challenge episode instead of one per concurrent fetch.
      const now = Date.now();
      if (now - this.challengeThrownAt < 60_000) {
        throw new Error("Cloudflare bypass pending — complete it and refresh.");
      }
      this.challengeThrownAt = now;
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

const fetchCheerio = async (url: string): Promise<cheerio.CheerioAPI> => {
  const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  return cheerio.load(Application.arrayBufferToUTF8String(buffer));
};

// WordPress pagination inserts /page/N/ into the path, before any query.
const pagedUrl = (base: string, page: number): string => {
  if (page <= 1) return base;
  const [path, query] = base.split("?");
  const pagedPath = `${path.replace(/\/+$/, "")}/page/${page}/`;
  return query ? `${pagedPath}?${query}` : pagedPath;
};

export const fetchListingPage = (path: string, page: number): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(pagedUrl(`${DOMAIN}${path}`, page));

export const fetchSearchPage = (
  page: number,
  query: string,
  sort?: string,
  filters?: SearchMetadata,
): Promise<cheerio.CheerioAPI> => {
  const params = [`s=${encodeURIComponent(query.trim())}`, `ep_sort=${sort || "date"}`];
  for (const taxonomy of TAXONOMIES) {
    const record = filters?.[taxonomy.key] ?? {};
    const included = Object.keys(record).filter((slug) => record[slug] === "included");
    if (included.length > 0) {
      params.push(`${taxonomy.param}=${encodeURIComponent(included.join(","))}`);
    }
  }
  const language = LANGUAGES.find((lang) => lang.code === filters?.language);
  if (language) params.push(`ep_filter_lang=${language.name}`);
  return fetchCheerio(pagedUrl(`${DOMAIN}/`, page) + `?${params.join("&")}`);
};

export const fetchMangaPage = (mangaId: string, part?: number): Promise<cheerio.CheerioAPI> =>
  fetchCheerio(`${DOMAIN}/${mangaId}/${part && part > 1 ? `${part}/` : ""}`);
