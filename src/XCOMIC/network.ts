/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import {
  API_URL,
  BROWSE_QUERY,
  CHAPTERS_QUERY,
  CHAPTER_PAGES_QUERY,
  COMIC_QUERY,
  LATEST_UPLOADS_QUERY,
  RECENTLY_ADDED_QUERY,
  CHAPTER_PAGE_SIZE,
  DOMAIN,
  PAGE_SIZE,
  type BrowseResponse,
  type BrowseSelect,
  type ChapterListResponse,
  type ChapterPagesResponse,
  type ComicNodeResponse,
  type GraphQLResponse,
  type LatestUploadsResponse,
  type RecentlyAddedResponse,
} from "./models";

export class XComicInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
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
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        // Data endpoints cannot render the challenge interstitial.
        url: request.url.startsWith(API_URL) ? `${DOMAIN}/` : request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

const fetchGraphQL = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({
    url: API_URL,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: query.trim(), variables }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${API_URL}`);
  }

  const body = Application.arrayBufferToUTF8String(buffer);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (error: unknown) {
    throw new Error(`Failed to parse JSON from ${API_URL}`, { cause: error });
  }

  if (!parsed || typeof parsed !== "object" || (!("data" in parsed) && !("errors" in parsed))) {
    throw new Error(`XCOMIC returned a malformed response from ${API_URL}`);
  }

  const payload = parsed as GraphQLResponse<T>;

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown API error").join("\n"));
  }
  if (!payload.data) throw new Error("XCOMIC returned an empty response");
  return payload.data;
};

export const fetchBrowse = (select: BrowseSelect): Promise<BrowseResponse> =>
  fetchGraphQL<BrowseResponse>(BROWSE_QUERY, { select });

export const fetchLatestUploads = (before?: number): Promise<LatestUploadsResponse> =>
  fetchGraphQL<LatestUploadsResponse>(LATEST_UPLOADS_QUERY, {
    select: { size: PAGE_SIZE, ...(before != null ? { before } : {}) },
  });

export const fetchRecentlyAdded = (): Promise<RecentlyAddedResponse> =>
  fetchGraphQL<RecentlyAddedResponse>(RECENTLY_ADDED_QUERY, { select: { size: 50 } });

export const fetchComic = (id: string): Promise<ComicNodeResponse> =>
  fetchGraphQL<ComicNodeResponse>(COMIC_QUERY, { id });

export const fetchChapters = (comicId: string, page: number): Promise<ChapterListResponse> =>
  fetchGraphQL<ChapterListResponse>(CHAPTERS_QUERY, {
    select: { comic_id: comicId, page, size: CHAPTER_PAGE_SIZE, sortby: "chapter_desc" },
  });

export const fetchSearchPage = async (): Promise<string> => {
  const url = `${DOMAIN}/search`;
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchChapterPages = (id: string): Promise<ChapterPagesResponse> =>
  fetchGraphQL<ChapterPagesResponse>(CHAPTER_PAGES_QUERY, { id });
