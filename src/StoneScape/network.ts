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
  type BannerResponse,
  type ChapterListResponse,
  type ChapterPagesResponse,
  type ContentType,
  type GenreResponse,
  type NovelChapterResponse,
  type PopularPeriod,
  type PopularSeriesResponse,
  type Series,
  type SeriesQuery,
  type SeriesResponse,
} from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|svg)(\/|\?|#|$)/i;

export class StoneScapeInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
        accept:
          request.headers?.accept ??
          (isImage
            ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
            : "application/json, text/plain, */*"),
        "accept-language": "en-US,en;q=0.9",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 && request.url.startsWith(DOMAIN));
    if (challenged) {
      // API routes cannot render the challenge, so solve it at the site root.
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

export const fetchApi = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  try {
    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
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

export const buildSeriesUrl = (query: SeriesQuery): string => {
  const url = apiUrl("series")
    .setQueryItem("page", query.page.toString())
    .setQueryItem("limit", (query.limit ?? 20).toString());

  if (query.contentType) url.setQueryItem("contentType", query.contentType);
  if (query.genres?.length) url.setQueryItem("genres", query.genres.join(","));
  if (query.status) url.setQueryItem("status", query.status);
  if (query.search) url.setQueryItem("search", query.search);
  if (query.sort && query.sort !== "latest") url.setQueryItem("sort", query.sort);
  return url.toString();
};

export const fetchSeries = (query: SeriesQuery): Promise<SeriesResponse> =>
  fetchApi<SeriesResponse>(buildSeriesUrl(query));

export const fetchBanner = (contentType: ContentType): Promise<BannerResponse> =>
  fetchApi<BannerResponse>(
    apiUrl(contentType === "novel" ? "novel-banner-config" : "banner-config").toString(),
  );

export const fetchPopular = (
  period: PopularPeriod,
  contentType: ContentType,
  limit: number,
): Promise<PopularSeriesResponse> =>
  fetchApi<PopularSeriesResponse>(
    apiUrl("series", "popular")
      .setQueryItem("period", period)
      .setQueryItem("contentType", contentType)
      .setQueryItem("limit", limit.toString())
      .toString(),
  );

export const fetchGenres = (): Promise<GenreResponse> =>
  fetchApi<GenreResponse>(apiUrl("genres").toString());

export const fetchSeriesDetails = (slug: string): Promise<Series> =>
  fetchApi<Series>(apiUrl("series", "by-slug", slug).toString());

export const fetchChapters = (slug: string): Promise<ChapterListResponse> =>
  fetchApi<ChapterListResponse>(apiUrl("series", "by-slug", slug, "chapters").toString());

export const fetchChapterPages = (chapterId: string): Promise<ChapterPagesResponse> =>
  fetchApi<ChapterPagesResponse>(apiUrl("chapters", chapterId, "pages").toString());

export const fetchNovelChapter = (
  slug: string,
  chapterNumber: string,
): Promise<NovelChapterResponse> =>
  fetchApi<NovelChapterResponse>(
    apiUrl("series", "by-slug", slug, "chapters", chapterNumber, "novel-content").toString(),
  );
