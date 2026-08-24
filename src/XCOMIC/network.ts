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

const BROWSE_QUERY = `
query get_comic_browse_items($select: Comic_Browse_Select) {
  get_comic_browse_items(select: $select) {
    data {
      id name
      urlCover
      translatedLanguage
      type contentRating genres tags
      summary { html }
      sfw_result score_val chaps_normal
      chapterNodes_last(amount: 1) {
        data {
          serial chaNum
        }
      }
    }
  }
}
`;

const LATEST_UPLOADS_QUERY = `
query get_comic_latestUploads($select: Comic_LatestUploads_Select) {
  get_comic_latestUploads(select: $select) {
    before
    items {
      comic {
        data {
          id name urlPath urlCover
          translatedLanguage
          type contentRating genres tags sfw_result
        }
      }
      chapters(amount: 1) {
        data {
          id serial chaNum urlPath
          dateCreate dateModify datePublic
        }
      }
    }
  }
}
`;

const RECENTLY_ADDED_QUERY = `
query get_comic_recentlyAdded($select: Comic_RecentlyAdded_Select) {
  get_comic_recentlyAdded(select: $select) {
    before
    items {
      data {
        id name urlPath urlCover
        translatedLanguage
        type contentRating genres tags sfw_result
      }
    }
  }
}
`;

const COMIC_QUERY = `
query get_comicNode($id: ID!) {
  get_comicNode(id: $id) {
    data {
      id name altNames
      originalLanguage translatedLanguage
      originalStatus originalPubFrom { y m d }
      originalPubTill { y m d }
      originalPubZone uploadStatus
      type demographics contentRating genres tags
      authorNodes { data { name } }
      artistNodes { data { name } }
      tagNodes { data { name } }
      publisherNodes { data { name } }
      summary { html }
      urlPath urlCover
      sfw_result score_val follows reviews comments_total chaps_normal
    }
  }
}
`;

const CHAPTERS_QUERY = `
query get_comic_chapterList_uniqList($select: Select_Comic_ChapterList_UniqList) {
  get_comic_chapterList_uniqList(select: $select) {
    paging { pages }
    items {
      data {
        id dbStatus serial chaNum
        dname title urlPath
        dateCreate dateModify datePublic
        srcName
        profileNodes { data { name } }
        userNode { data { name } }
        groupNodes { data { name } }
      }
    }
  }
}
`;

const CHAPTER_PAGES_QUERY = `
query get_chapterNode($id: ID!) {
  get_chapterNode(id: $id) {
    data { imageUrls }
  }
}
`;

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
