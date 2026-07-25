/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type PagedResults,
  type Request,
  type Response,
  type SearchResultItem,
} from "@paperback/types";

import { getDefaultAiMode, getDefaultGenres, getHideAdultContent } from "./forms/settings";
import {
  ADULT_EXCLUSIONS,
  API_URL,
  DOMAIN,
  PAGE_SIZE,
  type Novel,
  type NovelListResponse,
  type NovelSource,
  type SourceChapterEntry,
  type SourceChapterListResponse,
  type SourceListResponse,
} from "./models";
import { decodeId, dedupe, encodeId, parseMangaDetails, pickGenreValues } from "./parsers";

export class NovelArchiveInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // API calls carry the browser's JSON profile (the backend answers those
    // faster); everything else carries only the referer and user agent.
    const isApi = request.url.startsWith(API_URL);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
        ...(isApi
          ? {
              origin: DOMAIN,
              accept: "application/json, text/plain, */*",
              "accept-language": "en-US,en;q=0.5",
            }
          : {}),
      },
    };
  }

  override async interceptResponse(
    _request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      // API paths can't render the challenge; solving it on the site root
      // clears the clearance cookie domain-wide, funneling every hit to one bypass.
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

export const fetchApi = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  const data = Application.arrayBufferToUTF8String(buffer);
  try {
    return JSON.parse(data) as T;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${reason}`, { cause: error });
  }
};

export const novelsUrl = (...segments: string[]): string =>
  segments
    .reduce(
      (url, segment) => url.addPathComponent(segment),
      new URL(API_URL).addPathComponent("novels"),
    )
    .toString();

export const novelsFeedUrl = (segment: string, limit?: number): string => {
  const url = new URL(API_URL).addPathComponent("novels").addPathComponent(segment);
  if (limit !== undefined) url.setQueryItem("limit", limit.toString());
  return url.toString();
};

export const fetchNovel = async (mangaId: string): Promise<Novel> => {
  const data = await fetchApi<Novel | { novel: Novel }>(novelsUrl(decodeId(mangaId)));
  return "novel" in data && data.novel ? data.novel : (data as Novel);
};

export const fetchNovelArray = async (url: string): Promise<Novel[]> => {
  const data = await fetchApi<Novel[] | NovelListResponse>(url);
  return Array.isArray(data) ? data : (data.novels ?? []);
};

export const fetchBrowse = async (url: string): Promise<{ novels: Novel[]; hasNext: boolean }> => {
  const data = await fetchApi<NovelListResponse>(url);
  return { novels: data.novels ?? [], hasNext: data.pagination?.has_next ?? false };
};

// Mirror listings are optional extras; their absence should not take the
// native chapter list down with them.
export const fetchSources = async (id: string): Promise<NovelSource[]> => {
  try {
    const data = await fetchApi<NovelSource[] | SourceListResponse>(novelsUrl(id, "sources"));
    return Array.isArray(data) ? data : (data.sources ?? []);
  } catch (error: unknown) {
    if (error instanceof CloudflareError) throw error;
    return [];
  }
};

export const fetchSourceChapters = async (
  id: string,
  sourceId: string,
): Promise<SourceChapterEntry[]> => {
  try {
    const data = await fetchApi<SourceChapterEntry[] | SourceChapterListResponse>(
      novelsUrl(id, "sources", sourceId, "chapters"),
    );
    return Array.isArray(data) ? data : (data.chapters ?? []);
  } catch (error: unknown) {
    if (error instanceof CloudflareError) throw error;
    return [];
  }
};

export const buildNovelsUrl = (opts: {
  page: number;
  search?: string;
  sort?: string;
  status?: string;
  ai?: string;
  genreMatch?: string;
  genresInclude?: string[];
  genresExclude?: string[];
}): string => {
  const url = new URL(API_URL)
    .addPathComponent("novels")
    .setQueryItem("page", opts.page.toString())
    .setQueryItem("per_page", PAGE_SIZE.toString())
    .setQueryItem("ai_generated", opts.ai ?? getDefaultAiMode());

  if (opts.search) url.setQueryItem("search", opts.search);
  if (opts.sort) url.setQueryItem("sort", opts.sort);
  if (opts.status && opts.status !== "all") url.setQueryItem("status", opts.status);
  if (opts.genreMatch) url.setQueryItem("genre_match", opts.genreMatch);

  // The API matches genre filters against lowercased names, so send lowercase
  // values (as the site does) to keep the NSFW/genre filters reliable.
  const defaults = getDefaultGenres();
  const includes = dedupe(
    [...(opts.genresInclude ?? []), ...pickGenreValues(defaults, "included")].map((genre) =>
      genre.toLowerCase(),
    ),
  );
  if (includes.length > 0) url.setQueryItem("genres_include", includes.join(","));

  const excludes = dedupe(
    [
      ...(opts.genresExclude ?? []),
      ...pickGenreValues(defaults, "excluded"),
      ...(getHideAdultContent() ? ADULT_EXCLUSIONS : []),
    ].map((genre) => genre.toLowerCase()),
  );
  if (excludes.length > 0) url.setQueryItem("genres_exclude", excludes.join(","));

  return url.toString();
};

// A pasted novel/reader URL is an optional fast path to that single title;
// an unmatched query returns undefined so ordinary search continues.
export const resolveUrlQuery = async (
  query: string,
): Promise<PagedResults<SearchResultItem> | undefined> => {
  const trimmed = query.trim();
  if (!/^https?:\/\/(?:www\.)?novelarchive\.cc\//i.test(trimmed)) return undefined;
  // The novel page carries the id in ?id=, the reader in ?novel=; a path slug
  // is the older form.
  const id =
    trimmed.match(/[?&](?:id|novel)=([^&#]+)/i)?.[1] ?? trimmed.match(/\/novels?\/([^/?#]+)/i)?.[1];
  if (!id) return undefined;

  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // A malformed escape in a pasted URL falls back to the raw value.
  }
  const manga = parseMangaDetails(await fetchNovel(encodeId(decoded)));
  return {
    items: [
      {
        mangaId: manga.mangaId,
        title: manga.mangaInfo.primaryTitle,
        imageUrl: manga.mangaInfo.thumbnailUrl,
        contentRating: manga.mangaInfo.contentRating,
      },
    ],
  };
};
