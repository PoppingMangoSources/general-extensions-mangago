/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import { CookieStorageInterceptor, type Request } from "@paperback/types";
import * as cheerio from "cheerio";

import { MangaTownInterceptor } from "../../src/MangaTown/network";
import {
  parseChapterPageUrls,
  parseMangaDetails,
  parseMangaList,
  parseViewerImages,
} from "../../src/MangaTown/parsers";

Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: {
    decodeHTMLEntities: (value: string) => value.replaceAll("&amp;", "&"),
    getDefaultUserAgent: async () => "MangaTown test browser",
  },
});

void test("upgrades listing covers, detail covers, reader links and chapter images", () => {
  const image = "http://fmcdn.mangahere.com/store/manga/19411/ocover.jpg?token=fixture&amp;ttl=123";
  const secure = "https://fmcdn.mangahere.com/store/manga/19411/ocover.jpg?token=fixture&ttl=123";
  const listing = cheerio.load(
    `<ul class="manga_pic_list"><li><a class="manga_cover" href="/manga/example/"><img data-src="${image}"></a><p class="title"><a href="/manga/example/">Example</a></p></li></ul>`,
  );
  assert.equal(parseMangaList(listing)[0].imageUrl, secure);
  const details = cheerio.load(`<div class="detail_info"><img src="${image}"></div>`);
  assert.equal(parseMangaDetails(details, "example").mangaInfo.thumbnailUrl, secure);
  const reader = cheerio.load(
    `<select id="top_chapter_list"></select><div class="page_select"><select><option value="http://www.mangatown.com/manga/example/c001/2.html">2</option><option value="/manga/example/c001/3.html">3</option></select></div><div id="viewer"><img src="http://zjcdn.mangahere.org/store/001.jpg?token=fixture&amp;ttl=123"><img src="//zjcdn.mangahere.org/store/002.jpg"></div>`,
  );
  assert.deepEqual(parseChapterPageUrls(reader), [
    "https://www.mangatown.com/manga/example/c001/2.html",
    "https://www.mangatown.com/manga/example/c001/3.html",
  ]);
  assert.deepEqual(parseViewerImages(reader), [
    "https://zjcdn.mangahere.org/store/001.jpg?token=fixture&ttl=123",
    "https://zjcdn.mangahere.org/store/002.jpg",
  ]);
});

void test("upgrades HTTP requests from previously saved covers and preserves HTTPS requests", async () => {
  const interceptor = new MangaTownInterceptor("test");
  for (const scheme of ["http", "https"]) {
    const result = await interceptor.interceptRequest({
      url: `${scheme}://fmcdn.mangahere.com/cover.jpg?token=fixture&ttl=123`,
      method: "GET",
    });
    assert.equal(result.url, "https://fmcdn.mangahere.com/cover.jpg?token=fixture&ttl=123");
    assert.equal(result.headers?.referer, "https://www.mangatown.com/");
  }
});

void test("preserves image transport changes when the cookie interceptor receives the original request", async () => {
  const interceptor = new MangaTownInterceptor("test");
  const cookies = new CookieStorageInterceptor({ storage: "memory" });
  for (const prefix of ["http://", "https://", "//"]) {
    const request: Request = {
      url: `${prefix}fmcdn.mangahere.com/cover.jpg?token=fixture&ttl=123`,
      method: "GET",
      headers: { referer: "http://old.example/", "x-existing": "keep" },
      cookies: { existing: "keep" },
    };
    await interceptor.interceptRequest(request);
    const outgoing = await cookies.interceptRequest(request);
    assert.equal(outgoing.url, "https://fmcdn.mangahere.com/cover.jpg?token=fixture&ttl=123");
    assert.equal(outgoing.headers?.referer, "https://www.mangatown.com/");
    assert.equal(outgoing.headers?.["user-agent"], "MangaTown test browser");
    assert.equal(outgoing.headers?.["x-existing"], "keep");
    assert.equal(outgoing.cookies?.existing, "keep");
  }
});
