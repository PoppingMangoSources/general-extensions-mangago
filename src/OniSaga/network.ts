/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN, type PageApiResponse } from "./models";
import { extractReaderToken } from "./parsers";

// Matches a reader page-API url and captures the chapter id, e.g.
// https://onisaga.com/api/chapter/3718181/page/0
const PAGE_API_REGEX = /\/api\/chapter\/([^/]+)\/page\/\d+/;

// Bounds re-entrant page retries (the retry re-runs both interceptors).
const PAGE_RETRY_HEADER = "x-pb-page-retry";
const PAGE_RETRY_LIMIT = 2;

export class OniSagaInterceptor extends PaperbackInterceptor {
  // Per-chapter reader sessions (chapterId -> token + reader-page referer) set
  // by getChapterDetails; the page API wants both, like the site's own reader.
  private readerSessions = new Map<string, { token: string; referer: string }>();

  setReaderToken(chapterId: string, token: string, referer: string): void {
    this.readerSessions.set(chapterId, { token, referer });
  }

  override async interceptRequest(request: Request): Promise<Request> {
    // Keep a caller-provided Referer/Origin (Livewire calls send page-specific
    // ones); normalize to lower-case so the map never carries both casings.
    // Origin is only sent when a caller set it (browsers omit it on plain GETs).
    const headers: Record<string, string> = { ...request.headers };
    const referer = headers.referer ?? headers.Referer ?? `${DOMAIN}/`;
    const origin = headers.origin ?? headers.Origin;
    delete headers.Referer;
    delete headers.Origin;
    headers.referer = referer;
    if (origin) headers.origin = origin;
    headers["user-agent"] = await Application.getDefaultUserAgent();

    // A reader page-API request carries the chapter's signed token and the
    // reader page as referer, matching the site's own reader fetch.
    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    if (cid) {
      const session = this.readerSessions.get(cid);
      if (session) {
        headers["x-reader-token"] = session.token;
        headers.accept = "application/json";
        headers["sec-fetch-mode"] = "cors";
        headers["sec-fetch-site"] = "same-origin";
        headers.referer = session.referer;
      }
    }

    return { ...request, headers };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }

    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    const session = cid ? this.readerSessions.get(cid) : undefined;

    // The reader can rotate the chapter token; adopt the replacement so later
    // page requests stay authorized (the site's own reader does the same).
    const nextToken = response.headers?.["x-reader-token-next"];
    if (session && nextToken) session.token = nextToken;

    // Reader tokens expire after ~10 minutes, and the app requests pages long
    // after the chapter was opened. On an auth failure, re-mint a token from
    // the reader page and retry; the retry re-enters this interceptor with the
    // fresh token, bounded by a retry-count header.
    if (session && (response.status === 403 || response.status === 401)) {
      const attempt = Number(request.headers?.[PAGE_RETRY_HEADER] ?? "0");
      if (attempt < PAGE_RETRY_LIMIT) {
        const [, page] = await Application.scheduleRequest({
          url: session.referer,
          method: "GET",
        });
        const token = extractReaderToken(Application.arrayBufferToUTF8String(page));
        if (token) {
          session.token = token;
          const [, buffer] = await Application.scheduleRequest({
            url: request.url,
            method: "GET",
            headers: { ...request.headers, [PAGE_RETRY_HEADER]: String(attempt + 1) },
          });
          return buffer;
        }
      }
    }

    // Lazy page resolution: a page-API url returns JSON pointing at the real
    // signed image; fetch that and return its bytes. The image path (/_img/...)
    // differs, so this sub-request doesn't re-enter this branch.
    if (PAGE_API_REGEX.test(request.url) && response.status === 200) {
      try {
        const dto = JSON.parse(Application.arrayBufferToUTF8String(data)) as PageApiResponse;
        if (dto.url) {
          const [, imageBuffer] = await Application.scheduleRequest({
            url: dto.url,
            method: "GET",
            headers: { referer: session?.referer ?? `${DOMAIN}/` },
          });
          return imageBuffer;
        }
      } catch {
        // Fall through and return the original body; the reader shows a broken
        // page rather than hanging the whole chapter.
      }
    }

    return data;
  }
}
