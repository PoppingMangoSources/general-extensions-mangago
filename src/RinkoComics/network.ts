/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

export class RinkoComicsInterceptor extends PaperbackInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    // Image CDNs sit behind their own Cloudflare challenge; sending the
    // HTML `accept` on an image request is an anomalous, bot-like signal, so
    // send a browser-like image accept for images and an HTML accept
    // otherwise.
    const accept = IMAGE_EXTENSION_REGEX.test(request.url)
      ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8";

    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
        accept,
        "accept-language": "en-US,en;q=0.5",
      },
    };
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

    return data;
  }
}
