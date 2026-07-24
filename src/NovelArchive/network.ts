/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { API_URL, DOMAIN } from "./models";

// One native lookup for the whole session instead of one per request.
let userAgentPromise: Promise<string> | undefined;
const getUserAgent = (): Promise<string> =>
  (userAgentPromise ??= Application.getDefaultUserAgent());

export class NovelArchiveInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // API calls send the browser's JSON request profile — the backend answers
    // these markedly faster than bare requests — while other requests only
    // carry the referer and user agent.
    const isApi = request.url.startsWith(API_URL);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        "user-agent": await getUserAgent(),
        ...(isApi
          ? {
              origin: DOMAIN,
              accept: "application/json, text/plain, */*",
              "accept-language": "en-US,en;q=0.5",
            }
          : {}),
      },
    };
  }

  override async interceptResponse(
    _request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      // The API paths cannot render the challenge page; solving it on the
      // site root clears the clearance cookie for the whole domain, so every
      // challenged request funnels into one bypass.
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: {
          "user-agent": await getUserAgent(),
        },
      });
    }
    return data;
  }
}

export const fetchJSON = async <T>(request: Request): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest(request);

  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${request.url}`);
  }

  const data = Application.arrayBufferToUTF8String(buffer);
  try {
    return JSON.parse(data) as T;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${request.url}: ${reason}`, { cause: error });
  }
};
