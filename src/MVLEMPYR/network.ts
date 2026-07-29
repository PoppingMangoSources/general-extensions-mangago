/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  ASSETS_URL,
  CATALOGUE_PAGE_SIZE,
  CHAPTER_API,
  CHAPTER_PAGE_SIZE,
  DOMAIN,
  LATEST_PAGE_SIZE,
  type ChapterPostResponse,
} from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;

export class MvlempyrInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: request.headers?.referer ?? `${DOMAIN}/`,
        origin: request.headers?.origin ?? DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
        accept:
          request.headers?.accept ??
          (isImage
            ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
            : request.url.includes("/wp-json/")
              ? "application/json,*/*;q=0.8"
              : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
        "accept-language": "en-US,en;q=0.5",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const contentType = response.headers?.["content-type"] ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 && /(?:Just a moment|cf-chl-|_cf_chl_opt)/i.test(body))
    ) {
      // The JSON API endpoints cannot render the interstitial, so the
      // challenge is thrown to the challenged host's root instead; solving
      // it there clears the clearance cookie for the whole host.
      const root = request.url.match(/^https?:\/\/[^/]+/)?.[0];
      throw new CloudflareError({
        url: request.url.includes("/wp-json/") && root ? `${root}/` : request.url,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

const fetchBuffer = async (url: string): Promise<[Response, ArrayBuffer]> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) throw new Error(`Content not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return [response, buffer];
};

export const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(Application.arrayBufferToUTF8String((await fetchBuffer(url))[1]));

const fetchJSON = async <T>(url: string): Promise<T> => {
  const [, buffer] = await fetchBuffer(url);
  try {
    return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
  } catch (error: unknown) {
    throw new Error(`Unable to parse JSON response: ${url}`, { cause: error });
  }
};

export const novelUrl = (slug: string): string => `${DOMAIN}/novel/${slug}`;

export const chapterPageUrl = (chapterId: string): string => `${DOMAIN}/chapter/${chapterId}`;

export const coverUrl = (code: number, size: 300 | 600 = 600): string =>
  `${ASSETS_URL}/images/${size}/${code}.webp`;

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchDocument(`${DOMAIN}/`);

export const fetchNovelPage = (slug: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(novelUrl(slug));

export const fetchCataloguePage = (page: number): Promise<unknown[]> =>
  fetchJSON<unknown[]>(
    `${CHAPTER_API}/wp-json/wp/v2/mvl-novels?per_page=${CATALOGUE_PAGE_SIZE}&page=${page}`,
  );

export const fetchNovelChapterPosts = (
  tagId: number,
  page: number,
): Promise<{ posts: ChapterPostResponse[]; totalPages: number }> =>
  fetchPosts(`tags=${tagId}&per_page=${CHAPTER_PAGE_SIZE}&page=${page}`);

export const fetchLatestChapterPosts = (
  page: number,
): Promise<{ posts: ChapterPostResponse[]; totalPages: number }> =>
  fetchPosts(`per_page=${LATEST_PAGE_SIZE}&page=${page}`);

const fetchPosts = async (
  query: string,
): Promise<{ posts: ChapterPostResponse[]; totalPages: number }> => {
  const url = `${CHAPTER_API}/wp-json/wp/v2/posts?${query}`;
  const [response, buffer] = await fetchBuffer(url);
  let posts: ChapterPostResponse[];
  try {
    posts = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as ChapterPostResponse[];
  } catch (error: unknown) {
    throw new Error(`Unable to parse JSON response: ${url}`, { cause: error });
  }
  const totalHeader = Object.entries(response.headers ?? {}).find(
    ([key]) => key.toLowerCase() === "x-wp-totalpages",
  )?.[1];
  return { posts, totalPages: Number.parseInt(totalHeader ?? "1", 10) || 1 };
};
