/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { API_URL, DOMAIN } from "./models";

export class TempleScanInterceptor extends PaperbackInterceptor {
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
        url: `${DOMAIN}/`,
        method: "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

// Routes are Next.js App Router pages; the `rsc` header returns the flight
// stream carrying the page's data instead of the rendered HTML shell.
const fetchRsc = async (url: string): Promise<string> => {
  const [, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { rsc: "1" },
  });
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchDirectory = (): Promise<string> => fetchRsc(`${DOMAIN}/comics`);

export const fetchHomePage = (): Promise<string> => fetchRsc(`${DOMAIN}/`);

export const fetchSeriesPage = (mangaId: string): Promise<string> =>
  fetchRsc(`${DOMAIN}/comic/${mangaId}`);

export const fetchChapterPage = (mangaId: string, chapterId: string): Promise<string> =>
  fetchRsc(`${DOMAIN}/comic/${mangaId}/${chapterId}`);

const fetchApi = async (path: string): Promise<string> => {
  const [, buffer] = await Application.scheduleRequest({
    url: `${API_URL}${path}`,
    method: "GET",
  });
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchFeatured = (): Promise<string> => fetchApi("/banners");

export const fetchTrending = (): Promise<string> => fetchApi("/topSeries");
