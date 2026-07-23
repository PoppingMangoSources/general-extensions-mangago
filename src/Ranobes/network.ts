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

export const fetchPage = async (url: string): Promise<string> => {
  const [, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchListingPage = (path: string, page = 1): Promise<string> =>
  fetchPage(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterListPage = (novelId: string, page = 1): Promise<string> =>
  fetchPage(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);
