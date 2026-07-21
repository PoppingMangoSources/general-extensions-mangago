/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class MangaStreamInterceptor extends PaperbackInterceptor {
  constructor(id: string, getDomain: () => string) {
    super(id);
    this.getDomain = getDomain;
  }

  private readonly getDomain: () => string;

  override async interceptRequest(request: Request): Promise<Request> {
    const domain = this.getDomain();
    return {
      ...request,
      headers: {
        ...request.headers,
        "user-agent": await Application.getDefaultUserAgent(),
        referer: `${domain}/`,
        ...((request.url.includes("wordpress.com") || request.url.includes("wp.com")) && {
          accept: "image/avif,image/webp,*/*",
        }),
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
      const domain = this.getDomain();
      throw new CloudflareError(
        {
          url: request.url,
          method: request.method ?? "GET",
          headers: {
            referer: `${domain}/`,
            origin: domain,
            "user-agent": await Application.getDefaultUserAgent(),
          },
        },
        "Cloudflare detected, bypass it to continue!",
      );
    }

    if (response.status !== 200) {
      throw new Error(`Request failed with status ${response.status}: ${request.url}`);
    }

    return data;
  }
}
