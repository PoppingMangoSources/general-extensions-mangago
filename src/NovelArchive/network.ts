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

import { getDefaultGenres, getHideAdultContent } from "./forms/settings";
import {
  ADULT_EXCLUSIONS,
  API_URL,
  DOMAIN,
  PAGE_SIZE,
  type GenreListResponse,
  type GenreOptionDto,
  type Novel,
  type NovelDetailResponse,
  type NovelListResponse,
  type NovelSource,
  type SourceChapterEntry,
  type SourceChapterListResponse,
  type SourceListResponse,
} from "./models";
import { decodeId, encodeId, parseMangaDetails, pickGenreValues } from "./parsers";

// The cover endpoint content-negotiates: it 404s for a JSON/`*/*` Accept and only
// 302-redirects to the image for an image Accept, so covers get a browser image profile.
const isCoverUrl = (url: string): boolean => /\/cover(\?|$)/.test(url);

export class NovelArchiveInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isCover = isCoverUrl(request.url);
    const isApi = request.url.startsWith(API_URL) && !isCover;
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
          : isCover
            ? { accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" }
            : {}),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      // API paths can't render the challenge; bounce to the site root so one
      // bypass clears the clearance cookie domain-wide.
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: request.method ?? "GET",
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

export const novelsUrl = (...segments: string[]): string => {
  const url = new URL(API_URL).addPathComponent("novels");
  for (const segment of segments) url.addPathComponent(segment);
  return url.toString();
};

export const fetchNovel = async (mangaId: string): Promise<Novel> => {
  const data = await fetchApi<NovelDetailResponse>(novelsUrl(decodeId(mangaId)));
  return data.novel;
};

export const fetchNovels = async (url: string): Promise<Novel[]> => {
  const data = await fetchApi<NovelListResponse>(url);
  return data.novels;
};

export const fetchBrowse = async (url: string): Promise<{ novels: Novel[]; hasNext: boolean }> => {
  const data = await fetchApi<NovelListResponse>(url);
  return { novels: data.novels, hasNext: data.pagination?.has_next ?? false };
};

export const fetchGenres = async (): Promise<GenreOptionDto[]> => {
  const data = await fetchApi<GenreListResponse>(novelsUrl("genres"));
  return data.genres;
};

export const fetchSources = async (id: string): Promise<NovelSource[]> => {
  const request = fetchApi<SourceListResponse>(novelsUrl(id, "sources"));
  try {
    // /sources is optional and can hang ~30s before a 504; fall back to native chapters after 8s.
    const data = await Promise.race([request, Application.sleep(8).then(() => undefined)]);
    return data?.sources ?? [];
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
    const data = await fetchApi<SourceChapterListResponse>(
      novelsUrl(id, "sources", sourceId, "chapters"),
    );
    return data.chapters;
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
  genreMatch?: string;
  genresInclude?: string[];
  genresExclude?: string[];
}): string => {
  const url = new URL(API_URL)
    .addPathComponent("novels")
    .setQueryItem("page", opts.page.toString())
    .setQueryItem("per_page", PAGE_SIZE.toString());

  if (opts.search) {
    url.setQueryItem("search", opts.search);
    url.setQueryItem("fuzzy", "1");
  }
  if (opts.sort && opts.sort !== "recent") url.setQueryItem("sort", opts.sort);
  if (opts.status && opts.status !== "all") url.setQueryItem("status", opts.status);
  if (opts.genreMatch === "any") url.setQueryItem("genre_match", "any");

  const defaults = getDefaultGenres();
  const explicitIncludes = opts.genresInclude ?? [];
  const explicitExcludes = opts.genresExclude ?? [];
  const defaultIncludes = pickGenreValues(defaults, "included");
  const defaultExcludes = pickGenreValues(defaults, "excluded");
  const adultExcludes = getHideAdultContent() ? ADULT_EXCLUSIONS : [];

  const includes = [
    ...new Set([
      ...explicitIncludes.filter((genre) => !adultExcludes.includes(genre)),
      ...defaultIncludes.filter(
        (genre) => !explicitExcludes.includes(genre) && !adultExcludes.includes(genre),
      ),
    ]),
  ];
  if (includes.length > 0) url.setQueryItem("genres_include", includes.join(","));

  const excludes = [
    ...new Set(
      [
        ...explicitExcludes,
        ...defaultExcludes.filter((genre) => !explicitIncludes.includes(genre)),
        ...adultExcludes,
      ].filter(Boolean),
    ),
  ];
  if (excludes.length > 0) url.setQueryItem("genres_exclude", excludes.join(","));

  return url.toString();
};

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

  // Re-encode the decoded URL value so the Paperback id remains safe and self-sufficient.
  const mangaId = encodeId(decodeId(id));
  try {
    const manga = parseMangaDetails(await fetchNovel(mangaId), mangaId);
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
  } catch (error: unknown) {
    if (error instanceof CloudflareError) throw error;
    return undefined;
  }
};
