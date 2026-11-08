/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import * as cheerio from "cheerio";

import { MangaHomeInterceptor } from "../../src/MangaHome/network";
import { parseChapterImages, parseMangaDetails, parseMangaList } from "../../src/MangaHome/parsers";

Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: {
    decodeHTMLEntities: (value: string) => value.replaceAll("&amp;", "&"),
    getDefaultUserAgent: async () => "MangaHome test browser",
  },
});

void test("upgrades listing covers, detail covers and chapter images without changing their paths", () => {
  const image = "http://fmcdn.mangahere.com/store/manga/25957/ocover.jpg?token=fixture&amp;ttl=123";
  const secure = "https://fmcdn.mangahere.com/store/manga/25957/ocover.jpg?token=fixture&ttl=123";
  const listing = cheerio.load(
    `<ul class="manga-list"><li><a class="post-cover" href="/manga/example"><img data-src="${image}"></a><p class="title"><a href="/manga/example">Example</a></p></li></ul>`,
  );
  assert.equal(parseMangaList(listing)[0].imageUrl, secure);
  const details = cheerio.load(
    `<div class="manga-detail"><img class="detail-cover" src="${image}"></div>`,
  );
  assert.equal(parseMangaDetails(details, "example").mangaInfo.thumbnailUrl, secure);
  const reader = cheerio.load(
    `<div id="viewer"><img src="http://zjcdn.mangahere.org/store/001.jpg?token=fixture&amp;ttl=123"><img src="//zjcdn.mangahere.org/store/002.jpg"><img src="/store/003.jpg"></div>`,
  );
  assert.deepEqual(parseChapterImages(reader), [
    "https://zjcdn.mangahere.org/store/001.jpg?token=fixture&ttl=123",
    "https://zjcdn.mangahere.org/store/002.jpg",
    "https://www.mangahome.com/store/003.jpg",
  ]);
});

void test("upgrades HTTP requests from previously saved covers and preserves HTTPS requests", async () => {
  const interceptor = new MangaHomeInterceptor("test");
  for (const scheme of ["http", "https"]) {
    const result = await interceptor.interceptRequest({
      url: `${scheme}://fmcdn.mangahere.com/cover.jpg?token=fixture&ttl=123`,
      method: "GET",
    });
    assert.equal(result.url, "https://fmcdn.mangahere.com/cover.jpg?token=fixture&ttl=123");
    assert.equal(result.headers?.referer, "https://www.mangahome.com/");
  }
});
