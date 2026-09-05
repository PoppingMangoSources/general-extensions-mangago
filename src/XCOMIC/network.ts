/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { getBaseUrl, getSelectedBaseUrl, setActiveBaseUrl } from "./forms/settings";
import {
  CHAPTERS_QUERY,
  CHAPTER_PAGES_QUERY,
  COMIC_BROWSE_ITEMS_QUERY,
  COMIC_BROWSE_PAGER_QUERY,
  COMIC_QUERY,
  LATEST_UPLOADS_QUERY,
  RECENTLY_ADDED_QUERY,
  CHAPTER_PAGE_SIZE,
  MIRRORS,
  PAGE_SIZE,
  RECENTLY_ADDED_SIZE,
  type BrowseSelect,
  type ChapterListResponse,
  type ChapterPagesResponse,
  type ComicBrowseItemsResponse,
  type ComicBrowsePagerResponse,
  type ComicBrowseResponse,
  type ComicNodeResponse,
  type GraphQLResponse,
  type LatestUploadsResponse,
  type RecentlyAddedResponse,
  TITLE_BROWSE_ITEMS_QUERY,
  TITLE_BROWSE_PAGER_QUERY,
  type TitleBrowseItemsResponse,
  type TitleBrowsePagerResponse,
  type TitleBrowseResponse,
} from "./models";

const MIRROR_IDS = MIRRORS.map((mirror) => mirror.id);
const RETRYABLE_STATUS = new Set([403, 408, 500, 502, 503, 504, 521, 522, 523, 524]);

const mirrorOrigin = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}://${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    return MIRROR_IDS.includes(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
};

export class XComicInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const origin = mirrorOrigin(request.url) ?? getBaseUrl();
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${origin}/`,
        origin,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      const origin = mirrorOrigin(request.url) ?? getBaseUrl();
      throw new CloudflareError({
        // Data endpoints cannot render the challenge interstitial.
        url: /\/query\/(?:[?#]|$)/.test(request.url) ? `${origin}/` : request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

const fetchText = async (request: Request): Promise<string> => {
  const requestedOrigin = mirrorOrigin(request.url);
  const origins = [requestedOrigin, getBaseUrl(), getSelectedBaseUrl(), ...MIRROR_IDS].filter(
    (origin, index, values): origin is string =>
      Boolean(origin) && values.indexOf(origin) === index,
  );
  const candidates = requestedOrigin
    ? origins.map((origin) => request.url.replace(requestedOrigin, origin))
    : [request.url];
  let lastError: unknown;

  for (const [index, candidate] of candidates.entries()) {
    try {
      const [response, buffer] = await Application.scheduleRequest({
        ...request,
        url: candidate,
      });
      if (response.status === 200) {
        const successfulOrigin = mirrorOrigin(candidate);
        if (successfulOrigin) setActiveBaseUrl(successfulOrigin);
        return Application.arrayBufferToUTF8String(buffer);
      }
      lastError = new Error(`Request failed with status ${response.status}: ${candidate}`);
      if (
        response.status === 404 ||
        !RETRYABLE_STATUS.has(response.status) ||
        index === candidates.length - 1
      ) {
        break;
      }
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      lastError = error;
      if (index === candidates.length - 1) break;
    }
  }

  throw lastError ?? new Error(`Request failed: ${request.url}`);
};

const fetchGraphQL = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const apiUrl = `${getBaseUrl()}/query/`;
  const body = await fetchText({
    url: apiUrl,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: query.trim(), variables }),
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (error: unknown) {
    throw new Error(`Failed to parse JSON from ${apiUrl}`, { cause: error });
  }

  const payload = parsed as GraphQLResponse<T>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown API error").join("\n"));
  }
  if (!payload.data) throw new Error("XCOMIC returned an empty response");
  return payload.data;
};

export const fetchComicBrowse = async (select: BrowseSelect): Promise<ComicBrowseResponse> => {
  const [items, pager] = await Promise.all([
    fetchGraphQL<ComicBrowseItemsResponse>(COMIC_BROWSE_ITEMS_QUERY, { select }),
    fetchGraphQL<ComicBrowsePagerResponse>(COMIC_BROWSE_PAGER_QUERY, { select }),
  ]);
  return { ...items, ...pager };
};

export const fetchTitleBrowse = async (select: BrowseSelect): Promise<TitleBrowseResponse> => {
  const [items, pager] = await Promise.all([
    fetchGraphQL<TitleBrowseItemsResponse>(TITLE_BROWSE_ITEMS_QUERY, { select }),
    fetchGraphQL<TitleBrowsePagerResponse>(TITLE_BROWSE_PAGER_QUERY, { select }),
  ]);
  return { ...items, ...pager };
};

export const fetchLatestUploads = (before?: number): Promise<LatestUploadsResponse> =>
  fetchGraphQL<LatestUploadsResponse>(LATEST_UPLOADS_QUERY, {
    select: { size: PAGE_SIZE, ...(before != null ? { before } : {}) },
  });

export const fetchRecentlyAdded = (): Promise<RecentlyAddedResponse> =>
  fetchGraphQL<RecentlyAddedResponse>(RECENTLY_ADDED_QUERY, {
    select: { size: RECENTLY_ADDED_SIZE },
  });

export const fetchComic = (id: string): Promise<ComicNodeResponse> =>
  fetchGraphQL<ComicNodeResponse>(COMIC_QUERY, { id });

export const fetchChapters = (comicId: string, page: number): Promise<ChapterListResponse> =>
  fetchGraphQL<ChapterListResponse>(CHAPTERS_QUERY, {
    select: { comic_id: comicId, page, size: CHAPTER_PAGE_SIZE, sortby: "chapter_desc" },
  });

export const fetchSearchPage = (): Promise<string> =>
  fetchText({
    url: `${getBaseUrl()}/search`,
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml" },
  });

export const fetchTitlePage = (id: string): Promise<string> =>
  fetchText({
    url: `${getBaseUrl()}/title/${id}`,
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml" },
  });

export const fetchChapterPages = (id: string): Promise<ChapterPagesResponse> =>
  fetchGraphQL<ChapterPagesResponse>(CHAPTER_PAGES_QUERY, { id });
