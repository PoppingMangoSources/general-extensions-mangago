/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Cookie } from "@paperback/types";
import type * as cheerio from "cheerio";

import type { ReaderMetadata } from "./models";

export const loadChapterPages = async (
  $: cheerio.CheerioAPI,
  readerUrl: string,
  metadata: ReaderMetadata,
  cookies: Cookie[],
): Promise<string[]> => {
  const userAgent = await Application.getDefaultUserAgent();
  const result = await Application.executeInWebView({
    source: {
      html: $.html(),
      baseUrl: `${readerUrl}?f=mobile`,
      loadCSS: false,
      loadImages: false,
      userAgent,
    },
    inject: `
      return (async function () {
        var chapterId = ${JSON.stringify(metadata.chapterId)};
        var imageCount = ${metadata.imageCount};
        var pages = Array.from({ length: imageCount }, function () { return ""; });
        var keyInput = document.querySelector('input[id$="_key"], input[name="key"]');
        var key = keyInput && "value" in keyInput ? String(keyInput.value || "") : "";

        function normalize(value) {
          if (typeof value !== "string" || value.length === 0) return "";
          var link = document.createElement("a");
          link.href = value;
          return link.href;
        }

        function firstString(value) {
          if (typeof value === "string") return value;
          if (!Array.isArray(value)) return "";
          for (var index = 0; index < value.length; index++) {
            if (typeof value[index] === "string" && value[index].length > 0) return value[index];
          }
          return "";
        }

        async function loadPage(page) {
          for (var attempt = 0; attempt < 3; attempt++) {
            try {
              var response = await fetch(
                "chapterfun.ashx?cid=" + encodeURIComponent(chapterId) +
                  "&page=" + page +
                  "&key=" + encodeURIComponent(page === 1 && attempt === 0 ? key : ""),
                {
                  credentials: "include",
                  headers: { Accept: "*/*", "X-Requested-With": "XMLHttpRequest" },
                },
              );
              if (!response.ok) continue;

              var source = await response.text();
              if (!source) continue;
              window.d = undefined;
              window.newImgs = undefined;
              window.pix = undefined;
              window.pvalue = undefined;

              var evaluated;
              try {
                evaluated = window.eval(source);
              } catch (error) {
                continue;
              }

              var image = firstString(evaluated) || firstString(window.d) || firstString(window.newImgs);
              if (!image && typeof window.pix === "string") {
                var pageValue = firstString(window.pvalue);
                if (pageValue) image = window.pix + pageValue;
              }
              image = normalize(image);
              if (image) return image;
            } catch (error) {}
          }
          return "";
        }

        for (var start = 1; start <= imageCount; start += 4) {
          var batch = [];
          for (var page = start; page < Math.min(start + 4, imageCount + 1); page++) {
            batch.push(loadPage(page));
          }
          var resolved = await Promise.all(batch);
          for (var offset = 0; offset < resolved.length; offset++) {
            pages[start + offset - 1] = resolved[offset];
          }
          if (start === 1 && new RegExp("/images/war[.]jpg([?]|$)", "i").test(pages[0])) {
            return JSON.stringify([pages[0]]);
          }
        }

        return JSON.stringify(pages);
      })();
    `,
    storage: { cookies },
  });

  if (typeof result.result !== "string") {
    throw new Error(`The reader returned an invalid response for ${readerUrl}`);
  }

  let pages: unknown;
  try {
    pages = JSON.parse(result.result);
  } catch (cause) {
    throw new Error(`The reader returned malformed page data for ${readerUrl}`, { cause });
  }
  if (
    Array.isArray(pages) &&
    pages.length === 1 &&
    typeof pages[0] === "string" &&
    /\/images\/war\.jpg(?:\?|$)/i.test(pages[0])
  ) {
    throw new Error(`Chapter images are unavailable for ${readerUrl}`);
  }
  if (!Array.isArray(pages) || pages.length !== metadata.imageCount) {
    throw new Error(`The reader returned an incomplete page list for ${readerUrl}`);
  }

  const valid = pages.map((page) =>
    typeof page === "string" && /^https?:\/\//i.test(page) ? page : "",
  );
  const missing = valid.findIndex((page) => page.length === 0);
  if (missing < 0) return valid;
  if (missing === valid.length - 1 && valid.slice(0, -1).every((page) => page.length > 0)) {
    return valid.slice(0, -1);
  }
  throw new Error(`The reader could not load page ${missing + 1} for ${readerUrl}`);
};
