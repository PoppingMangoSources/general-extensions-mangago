/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Cookie,
  type Request,
  type Response,
} from "@paperback/types";

import {
  DOMAIN,
  READ_SITE_PAGE,
  SITE_PAGE_SETTLE_MS,
  SITE_PAGE_TIMEOUT_MS,
  type SitePageKind,
} from "./models";

const CHALLENGE_PAGE_REGEX = /\/app\/challenge\/page-[\w-]+\.js/;

const IMAGE_REGEX = /\/uploads\/|\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

export class TempleScanInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // Some covers live on third-party hosts whose hotlink protection swaps in
    // a placeholder when a foreign referer is attached; only claim the site
    // as referer on its own hosts. Cloudflare blocks requests that carry an
    // Origin header, so never send one.
    const firstParty = /^https:\/\/(?:[a-z0-9-]+\.)*templetoons\.com\//i.test(request.url);

    return {
      ...request,
      headers: {
        ...request.headers,
        ...(firstParty ? { referer: `${DOMAIN}/` } : {}),
        // The image host checks for the headers a browser sends with an image load.
        ...(IMAGE_REGEX.test(request.url)
          ? {
              accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
              "sec-fetch-site": "same-site",
              "sec-fetch-mode": "no-cors",
              "sec-fetch-dest": "image",
            }
          : {}),
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
    // The site serves its own Turnstile check in place of a page, with a 200, until a browser has
    // passed it; the check passes on its own in the app's browser and sends it back to the page.
    if (
      /^https:\/\/templetoons\.com\//i.test(request.url) &&
      !IMAGE_REGEX.test(request.url) &&
      CHALLENGE_PAGE_REGEX.test(Application.arrayBufferToUTF8String(data))
    ) {
      throw new CloudflareError({
        url: request.url,
        method: "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

// Without this an error body reaches the parsers as "no data".
const assertOk = (url: string, status: number): void => {
  if (status === 404) throw new Error(`Content not found: ${url}`);
  if (status < 200 || status >= 300) {
    throw new Error(`Request failed with status ${status}: ${url}`);
  }
};

export const fetchHtml = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  assertOk(url, response.status);
  return Application.arrayBufferToUTF8String(buffer);
};

// The page is fetched here, where a challenge is caught, and then run in a WebView so the site's
// app hydrates and its state can be read. Resolves undefined when a page settles without the data,
// as a locked chapter does.
export const readSitePage = async <T>(
  url: string,
  kind: SitePageKind,
  cookies: Cookie[],
): Promise<T | undefined> => {
  const html = await fetchHtml(url);
  const { result } = await Application.executeInWebView({
    source: {
      html,
      baseUrl: url,
      loadCSS: false,
      loadImages: false,
      userAgent: await Application.getDefaultUserAgent(),
    },
    // Serialized in the page, since the WebView writes large numbers in exponent form.
    inject: `
      const read = ${READ_SITE_PAGE};
      return new Promise((resolve) => {
        const started = Date.now();
        const poll = () => {
          const elapsed = Date.now() - started;
          const page = read(${JSON.stringify(kind)}, ${kind === "pages"} && elapsed >= ${SITE_PAGE_SETTLE_MS});
          if (page) resolve(JSON.stringify(page.data));
          else if (elapsed >= ${SITE_PAGE_TIMEOUT_MS}) resolve(null);
          else setTimeout(poll, 250);
        };
        poll();
      });
    `,
    storage: { cookies },
  });
  if (typeof result !== "string") {
    throw new Error(`Temple Scan: the page did not load its data in time: ${url}`);
  }
  try {
    return (JSON.parse(result) as T | null) ?? undefined;
  } catch (error) {
    throw new Error(`Temple Scan: could not read the page data for ${url}`, { cause: error });
  }
};
