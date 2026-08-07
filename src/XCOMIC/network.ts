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
  DOMAIN,
  type BrowseResponse,
  type BrowseSelect,
  type ChapterListResponse,
  type ComicNodeResponse,
  type GraphQLResponse,
} from "./models";

const BROWSE_QUERY = `
query get_comic_browse($select: Comic_Browse_Select) {
  get_comic_browse_pager(select: $select) {
    total pages page init size skip limit prev next
  }
  get_comic_browse_items(select: $select) {
    id
    data {
      id dbStatus isPublic
      name altNames
      originalLanguage translatedLanguage
      urlPath urlCover
      type demographics contentRating genres
      summary
      is_hot is_new sfw_result
      score_val follows reviews comments_total chaps_normal
      chapterNodes_last(amount: 1) {
        id
        data {
          id dateCreate dateModify datePublic
          dbStatus isFinal sfw_result
          dname title urlPath is_new serial chaNum volNum
        }
      }
    }
  }
}
`;

const COMIC_QUERY = `
query get_comicNode($id: ID!) {
  get_comicNode(id: $id) {
    id
    data {
      id dbStatus isPublic
      name altNames
      authors artists
      originalLanguage translatedLanguage
      originalStatus originalPubFrom { y m d }
      originalPubTill { y m d }
      originalPubZone uploadStatus
      type demographics contentRating genres tags publishers
      authorNodes { id data { id name urlPath } }
      artistNodes { id data { id name urlPath } }
      tagNodes { id data { id name urlPath } }
      publisherNodes { id data { id name urlPath } }
      summary extraInfo
      urlPath urlCover
      is_hot is_new sfw_result
      score_val follows reviews comments_total chaps_normal
    }
  }
}
`;

const CHAPTERS_QUERY = `
query get_comic_chapterList($select: Select_Comic_ChapterList) {
  get_comic_chapterList(select: $select) {
    paging { next }
    items {
      id
      data {
        id serial chaNum volNum
        dname title urlPath
        dateCreate dateModify datePublic
        userNode { id data { id name urlPath } }
        groupNodes { id data { id name urlPath } }
      }
    }
  }
}
`;

let userAgentPromise: Promise<string> | undefined;
const getUserAgent = (): Promise<string> =>
  (userAgentPromise ??= Application.getDefaultUserAgent());

export class XComicInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await getUserAgent(),
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
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await getUserAgent() },
      });
    }
    return data;
  }
}

const graphQL = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({
    url: API_URL,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${API_URL}`);
  }

  const body = Application.arrayBufferToUTF8String(buffer);
  let payload: GraphQLResponse<T>;
  try {
    payload = JSON.parse(body) as GraphQLResponse<T>;
  } catch (error: unknown) {
    throw new Error(`Failed to parse JSON from ${API_URL}`, { cause: error });
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? "Unknown API error").join("\n"));
  }
  if (!payload.data) throw new Error("XCOMIC returned an empty response");
  return payload.data;
};

export const fetchBrowse = (select: BrowseSelect): Promise<BrowseResponse> =>
  graphQL<BrowseResponse>(BROWSE_QUERY, { select });

export const fetchComic = (id: string): Promise<ComicNodeResponse> =>
  graphQL<ComicNodeResponse>(COMIC_QUERY, { id });

export const fetchChapters = (
  comicId: string,
  page: number,
  size: number,
): Promise<ChapterListResponse> =>
  graphQL<ChapterListResponse>(CHAPTERS_QUERY, {
    select: { comic_id: comicId, page, size },
  });

export const fetchChapterHtml = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  if (response.status === 404) throw new Error(`Chapter not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};
