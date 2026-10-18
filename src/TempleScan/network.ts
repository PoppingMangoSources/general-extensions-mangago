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
  CHALLENGE_TIMEOUT_MS,
  DOMAIN,
  READ_SITE_PAGE,
  SITE_PAGE_SETTLE_MS,
  SITE_PAGE_TIMEOUT_MS,
  type SitePageKind,
} from "./models";

const CHALLENGE_PAGE_REGEX = /\/app\/challenge\/page-[\w-]+\.js/;

const IMAGE_REGEX = /\/uploads\/|\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;

// The app's own user agent leaves out the Safari tokens a real browser sends, and the site answers
// it with its check page. The same completed agent is used for every request and WebView, so a pass
// earned in one is accepted by the other.
const completeMobileSafariUserAgent = (userAgent: string): string => {
  if (!/\b(?:iPhone|iPad|iPod)\b/.test(userAgent) || /\bSafari\//.test(userAgent)) {
    return userAgent;
  }
  const os = /\bOS (\d+)[_.](\d+)/.exec(userAgent);
  const version = os ? `${os[1]}.${os[2]}` : "18.0";
  const withVersion = /\bVersion\//.test(userAgent)
    ? userAgent
    : userAgent.replace(/\sMobile\//, ` Version/${version} Mobile/`);
  return /\bSafari\//.test(withVersion) ? withVersion : `${withVersion} Safari/604.1`;
};

let userAgentPromise: Promise<string> | undefined;

export const getUserAgent = (): Promise<string> =>
  (userAgentPromise ??= Application.getDefaultUserAgent().then(completeMobileSafariUserAgent));

// The headers a browser sends when it opens a page, which the site checks for.
const DOCUMENT_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "upgrade-insecure-requests": "1",
} as const;

export class TempleScanInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // Some covers live on third-party hosts whose hotlink protection swaps in
    // a placeholder when a foreign referer is attached; only claim the site
    // as referer on its own hosts. Cloudflare blocks requests that carry an
    // Origin header, so never send one.
    const firstParty = /^https:\/\/(?:[a-z0-9-]+\.)*templetoons\.com\//i.test(request.url);
    const isImage = IMAGE_REGEX.test(request.url);

    return {
      ...request,
      headers: {
        ...request.headers,
        ...(firstParty ? { referer: `${DOMAIN}/` } : {}),
        // The image host checks for the headers a browser sends with an image load.
        ...(!isImage && /^https:\/\/templetoons\.com\//i.test(request.url) ? DOCUMENT_HEADERS : {}),
        ...(isImage
          ? {
              accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
              "sec-fetch-site": "same-site",
              "sec-fetch-mode": "no-cors",
              "sec-fetch-dest": "image",
            }
          : {}),
        "user-agent": await getUserAgent(),
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
          "user-agent": await getUserAgent(),
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

// The site serves its own Turnstile check in place of a page, with a 200, until a browser passes it.
export const isChallengePage = (html: string): boolean => CHALLENGE_PAGE_REGEX.test(html);

// The check page runs Turnstile, which passes on its own in a browser, then posts the result to the
// site, which sets its pass cookie and moves on. The first same-origin post that succeeds is taken
// as the pass, and the page is held there so the WebView can hand back the cookie.
const CHALLENGE_BOOTSTRAP = `(function () {
  var done;
  window.__templePass = new Promise(function (resolve) { done = resolve; });
  setTimeout(function () { done(false); }, ${CHALLENGE_TIMEOUT_MS});
  var sameOrigin = function (url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  };
  var fetch = window.fetch;
  window.fetch = function (input, init) {
    var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    var url = typeof input === "string" ? input : input && input.url;
    var request = fetch.apply(this, arguments);
    if (method === "GET" || !sameOrigin(url)) return request;
    return request.then(function (response) {
      if (!response.ok) return response;
      done(true);
      return new Promise(function () {});
    });
  };
  var open = XMLHttpRequest.prototype.open;
  var send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__method = String(method).toUpperCase();
    this.__url = url;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (xhr.__method !== "GET" && sameOrigin(xhr.__url)) {
      xhr.addEventListener("load", function () {
        if (xhr.status >= 200 && xhr.status < 300) done(true);
      });
    }
    return send.apply(this, arguments);
  };
})();`;

// Resolves the cookies of a passed check, or undefined when it did not pass on its own.
export const passChallenge = async (
  html: string,
  url: string,
  cookies: Cookie[],
): Promise<Cookie[] | undefined> => {
  const bootstrap = `<script>${CHALLENGE_BOOTSTRAP}</script>`;
  const { result, storage } = await Application.executeInWebView({
    source: {
      html: /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (head) => `${head}${bootstrap}`)
        : `${bootstrap}${html}`,
      baseUrl: url,
      loadCSS: true,
      loadImages: false,
      userAgent: await getUserAgent(),
    },
    inject: "return window.__templePass;",
    storage: { cookies },
  });
  return result === true ? storage.cookies : undefined;
};

export const fetchHtml = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  assertOk(url, response.status);
  return Application.arrayBufferToUTF8String(buffer);
};

// The page is run in a WebView so the site's app hydrates and its state can be read. A kind the page
// does not hold is missing from the result once the page settles, as a locked chapter's images are.
export const readSitePage = async (
  html: string,
  url: string,
  kinds: SitePageKind[],
  cookies: Cookie[],
  settles = false,
): Promise<Partial<Record<SitePageKind, unknown>>> => {
  const { result } = await Application.executeInWebView({
    source: {
      html,
      baseUrl: url,
      loadCSS: false,
      loadImages: false,
      userAgent: await getUserAgent(),
    },
    // Serialized in the page, since the WebView writes large numbers in exponent form.
    inject: `
      const read = ${READ_SITE_PAGE};
      return new Promise((resolve) => {
        const started = Date.now();
        const poll = () => {
          const elapsed = Date.now() - started;
          const page = read(${JSON.stringify(kinds)}, ${settles} && elapsed >= ${SITE_PAGE_SETTLE_MS});
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
    return JSON.parse(result) as Partial<Record<SitePageKind, unknown>>;
  } catch (error) {
    throw new Error(`Temple Scan: could not read the page data for ${url}`, { cause: error });
  }
};
