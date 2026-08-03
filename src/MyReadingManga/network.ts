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

// Markers Cloudflare leaves in the interstitial it serves for a challenge.
const CHALLENGE_BODY = /Just a moment|cf-chl-|_cf_chl_opt|Attention Required!/i;

export class MyReadingMangaInterceptor extends PaperbackInterceptor {
  private challengeThrownAt = 0;

  clearChallenge(): void {
    this.challengeThrownAt = 0;
  }

  // A bare 403 is not proof of a challenge: the site returns one for hotlinked
  // images and for posts it will not serve, and raising a bypass prompt there
  // sent the reader to a webview that had nothing to solve. Trust the
  // cf-mitigated header, and otherwise require Cloudflare's own interstitial.
  private isChallenge(request: Request, response: Response, data: ArrayBuffer): boolean {
    if (response.headers?.["cf-mitigated"] === "challenge") return true;
    if (response.status !== 403 && response.status !== 503) return false;
    if (!request.url.startsWith(DOMAIN)) return false;
    const contentType = response.headers?.["content-type"] ?? response.mimeType ?? "";
    if (!contentType.includes("text/html")) return false;
    return CHALLENGE_BODY.test(Application.arrayBufferToUTF8String(data));
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
    if (this.isChallenge(request, response, data)) {
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
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  // Without this an error page parsed cleanly into zero cards, so a failed
  // request looked like a title with no chapters rather than a failure.
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
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
