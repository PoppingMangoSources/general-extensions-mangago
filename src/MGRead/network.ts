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
  DOMAIN,
  type ChapterListResponse,
  type SearchItem,
  type SearchMetadata,
  type Preferences,
  type MangaListItem,
  type TaxonomyItem,
} from "./models";
import { parseReaderProtection, ratingFor } from "./parsers";
import { decryptReader } from "./utils";
export class MGReadInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: request.headers?.referer ?? `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }
  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge")
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    return data;
  }
}
export const fetchJSON = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status !== 200)
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
};
export const fetchHtml = async (url: string): Promise<cheerio.CheerioAPI> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status !== 200)
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  return cheerio.load(Application.arrayBufferToUTF8String(buffer));
};
export const buildBrowseUrl = (page: number, sort: string, metadata: SearchMetadata): string => {
  const url = new URL(DOMAIN)
    .setPath(page > 1 ? `advanced-filter/page/${page}/` : "advanced-filter/")
    .setQueryItem("sort", sort);
  const genres = metadata.genres ?? [];
  if (genres.length) url.setQueryItem("genre[]", genres.map(decodeURIComponent));
  const fields = {
    type: metadata.types?.[0],
    status: metadata.status?.[0],
    age_rating: metadata.age?.[0],
    rating_min: metadata.ratingMin?.[0],
    rating_max: metadata.ratingMax?.[0],
  };
  for (const [key, value] of Object.entries(fields)) if (value) url.setQueryItem(key, value);
  return url.toString();
};
export const fetchContentPage = (id: string): Promise<cheerio.CheerioAPI> =>
  fetchHtml(new URL(DOMAIN).setPath(`manga/${decodeURIComponent(id)}/`).toString());
export const fetchChapterPage = (id: string, page: number): Promise<ChapterListResponse> =>
  fetchJSON<ChapterListResponse>(
    new URL(DOMAIN)
      .setPath("wp-json/initmanga/v1/chapters")
      .setQueryItem("manga_id", id)
      .setQueryItem("per_page", "50")
      .setQueryItem("paged", String(page))
      .toString(),
  );
export const fetchSearchPage = (term: string, page: number): Promise<SearchItem[]> =>
  fetchJSON<SearchItem[]>(
    new URL(DOMAIN)
      .setPath("wp-json/initlise/v1/search")
      .setQueryItem("term", term)
      .setQueryItem("page", String(page))
      .toString(),
  );
export const fetchReaderPage = async (id: string): Promise<cheerio.CheerioAPI> => {
  const document = await fetchContentPage(id);
  const protection = parseReaderProtection(document);
  if (!protection) return document;
  const { encrypted, config } = protection;
  let readerKey: string | undefined;
  if (encrypted.mode === "gated") {
    if (config.headlessGuardEnabled)
      throw new Error(
        "This chapter requires the website's browser verification. Open it on the site first.",
      );
    const [response, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/wp-json/initmanga/v1/chapter-key`,
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chapter_id: encrypted.cid,
        epoch: encrypted.e,
        grant: encrypted.g,
        verdict: "pass",
        score: 0,
        codes: [],
        challenge_token: "",
      }),
    });
    const result = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
      key?: string;
      message?: string;
    };
    if (response.status !== 200 || !result.key)
      throw new Error(
        result.message ??
          "The website did not provide this chapter's reader key. Open it on the site to check access.",
      );
    readerKey = result.key;
  }
  const plaintext = await decryptReader(protection, readerKey);
  document("#chapter-content").html(plaintext);
  return document;
};

export const applyContentFilters = async (
  items: MangaListItem[],
  preferences: Preferences,
): Promise<MangaListItem[]> => {
  if (preferences.ratings.length === 3 && !preferences.excludedGenres.length) return items;
  if (!items.length) return items;
  // Ranking cards omit taxonomy, so active filters use one batch lookup for the whole row.
  const url = new URL(DOMAIN)
    .setPath("wp-json/wp/v2/manga")
    .setQueryItem("slug", items.map((item) => decodeURIComponent(item.id)).join(","))
    .setQueryItem("per_page", "100")
    .setQueryItem("_fields", "slug,class_list");
  const taxonomy = await fetchJSON<TaxonomyItem[]>(url.toString());
  const bySlug = new Map(
    taxonomy.map((item) => [
      item.slug,
      item.class_list.filter((name) => name.startsWith("genre-")).map((name) => name.slice(6)),
    ]),
  );
  return items.flatMap((item) => {
    const genres = bySlug.get(decodeURIComponent(item.id));
    if (!genres) return [];
    const contentRating = ratingFor(genres);
    if (
      !preferences.ratings.includes(contentRating) ||
      genres.some((genre) => preferences.excludedGenres.includes(genre))
    )
      return [];
    return [{ ...item, genres, contentRating }];
  });
};
