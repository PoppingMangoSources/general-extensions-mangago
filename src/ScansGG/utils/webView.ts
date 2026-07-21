/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type CookieStorageInterceptor } from "@paperback/types";

import { USER_AGENT } from "../models";

const COLLECT_PAGES = `
  return new Promise(function (resolve) {
    var lastCount = -1;
    var stableTicks = 0;
    var attempts = 0;

    function collect() {
      var nodes = Array.prototype.slice.call(
        document.querySelectorAll('div.grid img.w-full.object-cover'),
      );
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
export const pageListViaWebView = async (
  readerUrl: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<string[]> => {
  const cookies = cookieInterceptor.cookiesForUrl(readerUrl);

  const [, buffer] = await Application.scheduleRequest({ url: readerUrl, method: "GET" });
  const html = Application.arrayBufferToUTF8String(buffer);

  const raw = await Application.executeInWebView({
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
};
