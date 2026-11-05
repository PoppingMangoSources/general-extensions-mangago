/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { cookieStorage, getRanobesUserAgent } from "./network";

export const fetchChapterPagesInWebView = async (urls: string[]): Promise<string[]> => {
  const baseUrl = urls[0];
  // The WebView bridge requires expires even for session cookies.
  const sessionExpiry = new Date(Date.now() + 5 * 60_000);
  const cookies = cookieStorage
    .cookiesForUrl(baseUrl)
    .map((cookie) => (cookie.expires ? cookie : { ...cookie, expires: sessionExpiry }));
  const execution = await Application.executeInWebView({
    source: {
      baseUrl,
      userAgent: await getRanobesUserAgent(),
      loadCSS: false,
      loadImages: false,
      html: `<!doctype html><script>
        window.__ranobesChapterPages = (async () => {
          const pages = [];
          for (const url of ${JSON.stringify(urls)}) {
            const startedAt = Date.now();
            try {
              const response = await fetch(url, { credentials: "include" });
              if (!response.ok) break;
              const document = new DOMParser().parseFromString(await response.text(), "text/html");
              const script = Array.from(document.scripts)
                .find(script => /window\\.__DATA__\\s*=/.test(script.textContent));
              if (!script) break;
              pages.push(script.outerHTML);
            } catch {
              break;
            }
            if (pages.length < ${urls.length}) {
              await new Promise(resolve => setTimeout(resolve, Math.max(0, 1000 - (Date.now() - startedAt))));
            }
          }
          return pages;
        })();
      </script>`,
    },
    inject: "return window.__ranobesChapterPages;",
    storage: { cookies },
  });
  const { result } = execution;
  if (
    !Array.isArray(result) ||
    result.length > urls.length ||
    !result.every((page): page is string => typeof page === "string")
  ) {
    throw new Error("Ranobes WebView did not return a valid chapter list.");
  }
  return result;
};
