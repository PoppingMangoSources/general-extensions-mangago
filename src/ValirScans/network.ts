/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { getBaseUrl, type SearchMetadata, type TriState } from "./models";

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

const pickState = (record: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.keys(record ?? {}).filter((id) => record?.[id] === state);

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
  const triStateParams: [string, TriState | undefined][] = [
    ["genre", filters?.genres],
    ["tag", filters?.tags],
    ["type", filters?.types],
    ["status", filters?.statuses],
    ["origin", filters?.origins],
  ];
  for (const [param, record] of triStateParams) {
    const included = pickState(record, "included");
    const excluded = pickState(record, "excluded");
    if (included.length > 0) url.setQueryItem(param, included);
    if (excluded.length > 0) {
      url.setQueryItem(`exclude${param.charAt(0).toUpperCase()}${param.slice(1)}`, excluded);
    }
  }
  if (filters?.minChapters) url.setQueryItem("minChapters", filters.minChapters);
  if (filters?.maxChapters) url.setQueryItem("maxChapters", filters.maxChapters);
  return fetchPage(url.toString());
};

export const fetchSeriesPage = (mangaId: string, page = 1): Promise<string> =>
  fetchPage(`${getBaseUrl()}/series/${mangaId}${page > 1 ? `?page=${page}` : ""}`);

// The reader route serves its data as a Next.js RSC flight stream; the `rsc`
// header returns that stream directly instead of the full HTML shell.
export const fetchChapterPage = (mangaId: string, chapterId: string): Promise<string> =>
  fetchPage(`${getBaseUrl()}/series/${mangaId}/chapter/${chapterId}`, true);
