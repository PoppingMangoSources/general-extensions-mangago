/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type CookieStorageInterceptor } from "@paperback/types";

import { USER_AGENT } from "../models";

// The reader renders page images client-side, and the `/chapter-navigation`
// API endpoint is slow/unreliable (frequently times out). Loading the reader
// page in a WebView lets its own scripts fetch and lay out the pages, then we
// scrape the resolved <img> sources — the approach the site itself relies on.
const COLLECT_PAGES = `
  return new Promise(function (resolve) {
    var lastCount = -1;
    var stableTicks = 0;
    var attempts = 0;

    function collect() {
      var nodes = Array.prototype.slice.call(
        document.querySelectorAll('div.grid img.w-full.object-cover'),
      );
      // Fallback: any <img> pointing at the page CDN if the layout markup changed.
      if (nodes.length === 0) {
        nodes = Array.prototype.slice.call(document.querySelectorAll('img')).filter(function (img) {
          var src = img.getAttribute('src') || img.currentSrc || img.src || '';
          return src.indexOf('cdn.scans.gg') > -1 || src.indexOf('/pages/') > -1;
        });
      }

      var urls = nodes
        .map(function (img) {
          return img.getAttribute('src') || img.currentSrc || img.src || '';
        })
        .filter(function (src) {
          return src.length > 0 && src.indexOf('data:') !== 0;
        });

      // Resolve once the page count holds steady (all images mounted) or we
      // run out of patience (~25s).
      if (urls.length > 0 && urls.length === lastCount) {
        stableTicks++;
      } else {
        stableTicks = 0;
      }
      lastCount = urls.length;

      if ((urls.length > 0 && stableTicks >= 2) || attempts++ > 50) {
        resolve(JSON.stringify(urls));
        return;
      }
      setTimeout(collect, 500);
    }

    collect();
  });
`;

/** Load the reader page in a WebView and return the resolved page image URLs. */
export async function pageListViaWebView(
  readerUrl: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<string[]> {
  const cookies = cookieInterceptor.cookiesForUrl(readerUrl);

  const [, buffer] = await Application.scheduleRequest({ url: readerUrl, method: "GET" });
  const html = Application.arrayBufferToUTF8String(buffer);

  const raw = await Application.executeInWebView({
    // Images must render for their src to resolve, so keep loadImages on.
    source: { html, baseUrl: readerUrl, loadCSS: false, loadImages: true, userAgent: USER_AGENT },
    inject: COLLECT_PAGES,
    storage: { cookies },
  });

  if (typeof raw.result !== "string" || raw.result.length === 0) return [];

  try {
    const parsed = JSON.parse(raw.result) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((url): url is string => typeof url === "string" && url.length > 0);
  } catch {
    return [];
  }
}
