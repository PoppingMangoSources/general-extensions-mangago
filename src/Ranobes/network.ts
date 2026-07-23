/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models";

export class RanobesInterceptor extends PaperbackInterceptor {
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
    const contentType = response.headers?.["content-type"] ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      response.status === 403 ||
      /(?:Just a moment|Security check|vb_challenge)/i.test(body)
    ) {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

export const fetchHtml = async (url: string): Promise<string> => {
  const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchHomepage = (): Promise<string> => fetchHtml(`${DOMAIN}/`);

export const fetchListing = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterList = (novelId: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);

export const fetchFilter = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);
