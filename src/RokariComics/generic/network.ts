/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

export class MangaStreamInterceptor extends PaperbackInterceptor {
  domain: string;

  constructor(id: string, domain: string) {
    super(id);
    this.domain = domain;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${this.domain}/`,
      ...((request.url.includes("wordpress.com") || request.url.includes("wp.com")) && {
        Accept: "image/avif,image/webp,*/*",
      }),
    };

    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError(
        {
          url: this.domain,
          method: "GET",
          headers: {
            referer: `${this.domain}/`,
            origin: `${this.domain}/`,
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
