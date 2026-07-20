/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { getDomain } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;

export class OMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);

    return {
      ...request,
      headers: {
        ...request.headers,
        // Covers and pages live on a separate image host that checks the
        // Referer; site documents want a plain navigation accept.
        referer: `${getDomain()}/`,
        "user-agent": await Application.getDefaultUserAgent(),
        accept: isImage
          ? "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    // Always challenge against the homepage so simultaneous failures collapse
    // into a single bypass prompt instead of one per URL. A bare 403 only
    // counts for the site itself — the image host has its own failure modes.
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 && request.url.startsWith(getDomain()));
    if (challenged) {
      throw new CloudflareError({
        url: `${getDomain()}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

export const fetchHtmlPage = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  return Application.arrayBufferToUTF8String(buffer);
};

/**
 * GET a page's bare data payload — the same stream the site's own client-side
 * navigation requests. A fraction of the full page's size, so it's the fast
 * path; callers fall back to the full page if the payload comes up short.
 */
export const fetchFlightPayload = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { rsc: "1" },
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Payload request failed with status ${response.status}: ${url}`);
  }

  return Application.arrayBufferToUTF8String(buffer);
};
