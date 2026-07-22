/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { getBaseUrl, type SearchMetadata } from "./models";

export class ValirScansInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${getBaseUrl()}/`,
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
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

const fetchPage = async (url: string, rsc = false): Promise<string> => {
  const [, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: rsc ? { rsc: "1" } : undefined,
  });
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchHomePage = (): Promise<string> => fetchPage(`${getBaseUrl()}/`);

export const fetchBrowsePage = (
  page: number,
  query?: string,
  sort?: string,
  filters?: SearchMetadata,
): Promise<string> => {
  const url = new URL(`${getBaseUrl()}/series`).setQueryItem("page", page.toString());
  if (query?.trim()) url.setQueryItem("q", query.trim());
  if (sort) {
    url.setQueryItem("sort", sort).setQueryItem("order", "desc");
  }
  if (filters?.genres?.length) url.setQueryItem("genre", filters.genres);
  if (filters?.tags?.length) url.setQueryItem("tag", filters.tags);
  if (filters?.type) url.setQueryItem("type", filters.type);
  if (filters?.status) url.setQueryItem("status", filters.status);
  if (filters?.origin) url.setQueryItem("origin", filters.origin);
  return fetchPage(url.toString());
};

export const fetchSeriesPage = (mangaId: string, page = 1): Promise<string> =>
  fetchPage(`${getBaseUrl()}/series/${mangaId}${page > 1 ? `?page=${page}` : ""}`);

// The reader route serves its data as a Next.js RSC flight stream; the `rsc`
// header returns that stream directly instead of the full HTML shell.
export const fetchChapterPage = (mangaId: string, chapterId: string): Promise<string> =>
  fetchPage(`${getBaseUrl()}/series/${mangaId}/chapter/${chapterId}`, true);
