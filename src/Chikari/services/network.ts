/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import {
  API_URL,
  DOMAIN,
  PAGE_SIZE,
  type ChapterDetailsResponse,
  type ChapterListResponse,
  type ChikariPreferences,
  type GenreOption,
  type HomeResponse,
  type Period,
  type SeriesDetails,
  type SeriesListResponse,
  type SeriesStatus,
  type SeriesType,
  type SortId,
  type TagOption,
} from "../implementations/shared/models";

const headerValue = (
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined => {
  const wanted = name.toLowerCase();
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === wanted)?.[1];
};

const completeMobileSafariUserAgent = (userAgent: string): string => {
  if (!/\b(?:iPhone|iPad|iPod)\b/.test(userAgent) || /\bSafari\//.test(userAgent)) {
    return userAgent;
  }
  const os = /\bOS (\d+)[_.](\d+)/.exec(userAgent);
  const version = os ? `${os[1]}.${os[2]}` : "18.0";
  const withVersion = /\bVersion\//.test(userAgent)
    ? userAgent
    : userAgent.replace(/\sMobile\//, ` Version/${version} Mobile/`);
  return /\bSafari\//.test(withVersion) ? withVersion : `${withVersion} Safari/604.1`;
};

const getUserAgent = async (): Promise<string> =>
  completeMobileSafariUserAgent(await Application.getDefaultUserAgent());

export class ChikariInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        accept: request.url.startsWith(API_URL)
          ? "application/json, text/plain, */*"
          : (request.headers?.accept ?? "*/*"),
        origin: DOMAIN,
        referer: `${DOMAIN}/`,
        "user-agent": await getUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const challenged =
      headerValue(response.headers, "cf-mitigated")?.toLowerCase() === "challenge" ||
      (response.status === 403 &&
        /just a moment|challenge-platform|cf-browser-verification|_cf_chl_opt/i.test(
          Application.arrayBufferToUTF8String(data),
        ));
    if (!challenged) return data;

    // API routes cannot render the challenge, so bypass at the site root.
    throw new CloudflareError({
      url: `${DOMAIN}/`,
      method: request.method ?? "GET",
      headers: { "user-agent": await getUserAgent() },
    });
  }
}

export const fetchApi = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  const text = Application.arrayBufferToUTF8String(buffer);
  try {
    return JSON.parse(text) as T;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${reason}`, { cause: error });
  }
};

const apiUrl = (...segments: string[]): URL => {
  const url = new URL(API_URL);
  for (const segment of segments) url.addPathComponent(segment);
  return url;
};

const addPreferences = (url: URL, preferences: ChikariPreferences): URL => {
  url
    .setQueryItem("adult", String(preferences.adult))
    .setQueryItem("content_rating", preferences.contentRatings.join(","))
    .setQueryItem("type", preferences.types);
  if (preferences.excludedGenres.length > 0) {
    url.setQueryItem("genre_exclude", preferences.excludedGenres);
  }
  if (preferences.excludedTags.length > 0) {
    url.setQueryItem("tag_exclude", preferences.excludedTags);
  }
  return url;
};

export const fetchHome = async (preferences: ChikariPreferences): Promise<HomeResponse> =>
  fetchApi<HomeResponse>(addPreferences(apiUrl("home"), preferences).toString());

export const fetchGenres = async (adult: boolean): Promise<GenreOption[]> =>
  fetchApi<GenreOption[]>(apiUrl("genres").setQueryItem("adult", String(adult)).toString());

export const fetchTags = async (adult: boolean): Promise<TagOption[]> =>
  fetchApi<TagOption[]>(apiUrl("tags").setQueryItem("adult", String(adult)).toString());

export interface SeriesQueryOptions {
  contentRatings: ChikariPreferences["contentRatings"];
  adult: boolean;
  excludedGenres: string[];
  excludedTags: string[];
  genres: string[];
  limit?: number;
  minChapters?: number;
  offset: number;
  period?: Period;
  query?: string;
  sort: SortId;
  statuses: SeriesStatus[];
  tags: string[];
  types: SeriesType[];
  years: string[];
}

const buildSeriesUrl = (options: SeriesQueryOptions): string => {
  const sort = options.sort === "trending" ? `trending_${options.period ?? "week"}` : options.sort;
  const url = apiUrl("series")
    .setQueryItem("sort", sort)
    .setQueryItem("adult", String(options.adult))
    .setQueryItem("content_rating", options.contentRatings.join(","))
    .setQueryItem("limit", String(options.limit ?? PAGE_SIZE))
    .setQueryItem("offset", String(options.offset));

  if (options.query) url.setQueryItem("q", options.query);
  if (options.types.length > 0) url.setQueryItem("type", options.types);
  if (options.genres.length > 0) url.setQueryItem("genre", options.genres);
  if (options.excludedGenres.length > 0) {
    url.setQueryItem("genre_exclude", options.excludedGenres);
  }
  if (options.tags.length > 0) url.setQueryItem("tag", options.tags);
  if (options.excludedTags.length > 0) url.setQueryItem("tag_exclude", options.excludedTags);
  if (options.statuses.length > 0) url.setQueryItem("status", options.statuses);
  if (options.years.length > 0) url.setQueryItem("year", options.years);
  if (options.minChapters !== undefined) {
    url.setQueryItem("min_chapters", String(options.minChapters));
  }
  if (options.period && options.sort !== "trending") {
    url.setQueryItem("period", options.period);
  }
  return url.toString();
};

export const fetchSeries = async (options: SeriesQueryOptions): Promise<SeriesListResponse> =>
  fetchApi<SeriesListResponse>(buildSeriesUrl(options));

export const fetchSeriesDetails = async (slug: string): Promise<SeriesDetails> =>
  fetchApi<SeriesDetails>(apiUrl("series", slug).toString());

export const fetchChapters = async (slug: string): Promise<ChapterListResponse> =>
  fetchApi<ChapterListResponse>(
    apiUrl("series", slug, "chapters")
      .setQueryItem("order", "asc")
      .setQueryItem("limit", "100000")
      .setQueryItem("offset", "0")
      .toString(),
  );

export const fetchChapterDetails = async (
  slug: string,
  chapterId: string,
): Promise<ChapterDetailsResponse> =>
  fetchApi<ChapterDetailsResponse>(apiUrl("series", slug, "chapters", chapterId).toString());
