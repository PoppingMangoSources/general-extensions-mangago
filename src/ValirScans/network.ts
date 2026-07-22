/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models";

export class ValirScansInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
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

const fetchPage = async (url: string): Promise<string> => {
  const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchHomePage = (): Promise<string> => fetchPage(`${DOMAIN}/`);

export const fetchBrowsePage = (page: number, query?: string, sort?: string): Promise<string> => {
  const params = [`page=${page}`];
  if (query) {
    params.push(`q=${encodeURIComponent(query.trim())}`);
  }
  if (sort) {
    params.push(`sort=${encodeURIComponent(sort)}`, "order=desc");
  }
  return fetchPage(`${DOMAIN}/series?${params.join("&")}`);
};

export const fetchSeriesPage = (mangaId: string, page = 1): Promise<string> =>
  fetchPage(`${DOMAIN}/series/${mangaId}${page > 1 ? `?page=${page}` : ""}`);

export const fetchChapterPage = (mangaId: string, chapterId: string): Promise<string> =>
  fetchPage(`${DOMAIN}/series/${mangaId}/chapter/${chapterId}`);
