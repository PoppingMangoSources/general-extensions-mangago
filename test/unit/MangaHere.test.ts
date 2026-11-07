/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CloudflareError,
  ContentRating,
  type Chapter,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

const application = {
  getState: () => undefined,
  getDefaultUserAgent: async () => "MangaHere test browser",
  decodeHTMLEntities: (value: string) => value.replaceAll("&amp;", "&"),
  arrayBufferToUTF8String: (value: ArrayBuffer) => new TextDecoder().decode(value),
  scheduleRequest: async (_request: Request): Promise<[Response, ArrayBuffer]> => {
    throw new Error("Unexpected network request");
  },
  sleep: async (_seconds: number) => {},
};
Object.defineProperty(globalThis, "Application", { configurable: true, value: application });
const { MangaHere } = await import("../../src/MangaHere/main");
const { fetchDocument, MangaHereInterceptor } = await import("../../src/MangaHere/network");
const { parseMangaList } = await import("../../src/MangaHere/parsers");

const reply = (url: string, body: string): [Response, ArrayBuffer] => [
  { url, status: 200, headers: {}, cookies: [] },
  new TextEncoder().encode(body).buffer,
];
const chapter: Chapter = {
  chapterId: "v20/c187",
  chapNum: 187,
  volume: 20,
  title: "",
  langCode: "en",
  sourceManga: {
    mangaId: "tsugumomo",
    mangaInfo: {
      primaryTitle: "Tsugumomo",
      secondaryTitles: [],
      thumbnailUrl: "https://fmcdn.mangahere.com/cover.jpg",
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
    },
  },
};

void test("reads the complete mobile reader in one request and returns secure image URLs", async (t) => {
  const requests: Request[] = [];
  t.mock.method(application, "scheduleRequest", async (request: Request) => {
    requests.push(request);
    return reply(
      request.url,
      `
      <img data-original="https://ads.example/ad.jpg">
      <div id="viewer">
        <img data-original="//zjcdn.mangahere.org/store/manga/6605/20-187.0/001.jpg?token=fixture&amp;ttl=123" src="/loading.gif">
        <img data-original="http://zjcdn.mangahere.org/store/manga/6605/20-187.0/002.jpg">
        <img src="https://zjcdn.mangahere.org/store/manga/6605/20-187.0/003.jpg">
        <img src="https://zjcdn.mangahere.org/store/manga/6605/20-187.0/003.jpg">
        <img src="/loading.gif">
      </div>`,
    );
  });
  assert.deepEqual(await MangaHere.getChapterDetails(chapter), {
    id: "v20/c187",
    mangaId: "tsugumomo",
    pages: [
      "https://zjcdn.mangahere.org/store/manga/6605/20-187.0/001.jpg?token=fixture&ttl=123",
      "https://zjcdn.mangahere.org/store/manga/6605/20-187.0/002.jpg",
      "https://zjcdn.mangahere.org/store/manga/6605/20-187.0/003.jpg",
    ],
  });
  assert.deepEqual(
    requests.map(({ url }) => url),
    ["https://m.mangahere.cc/roll_manga/tsugumomo/v20/c187/1.html"],
  );
});

void test("upgrades HTTP catalogue covers and cached image requests to HTTPS", async () => {
  const $ = cheerio.load(`<ul><li>
    <p class="manga-list-1-item-title"><a href="/manga/tsugumomo/">Tsugumomo</a></p>
    <img class="manga-list-1-cover" src="http://fmcdn.mangahere.com/store/manga/6605/cover.jpg?token=fixture&amp;ttl=123">
  </li></ul>`);
  assert.equal(
    parseMangaList($, "li")[0].imageUrl,
    "https://fmcdn.mangahere.com/store/manga/6605/cover.jpg?token=fixture&ttl=123",
  );
  const prepared = await new MangaHereInterceptor("test-mangahere").interceptRequest({
    url: "http://fmcdn.mangahere.com/store/manga/6605/cover.jpg?token=fixture&ttl=123",
    method: "GET",
  });
  assert.equal(
    prepared.url,
    "https://fmcdn.mangahere.com/store/manga/6605/cover.jpg?token=fixture&ttl=123",
  );
});

void test("uses the desktop reader when the mobile reader has no chapter", async (t) => {
  const requests: string[] = [];
  const script = "var newImgs = ['http://fmcdn.mangahere.com/store/manga/6605/page.jpg'];";
  const packed = `eval(function(p,a,c,k,e,d){return p;}(${JSON.stringify(script)},0,0,[],0,{}))`;
  t.mock.method(application, "scheduleRequest", async ({ url }: Request) => {
    requests.push(url);
    return reply(
      url,
      url.includes("/roll_manga/")
        ? '<div class="also-like">This series is unavailable.</div>'
        : `<script>var chapterid=123;var imagecount=2;</script><script src="/chapter_bar.js"></script><script>${packed}</script>`,
    );
  });
  assert.deepEqual(await MangaHere.getChapterDetails(chapter), {
    id: "v20/c187",
    mangaId: "tsugumomo",
    pages: ["https://fmcdn.mangahere.com/store/manga/6605/page.jpg"],
  });
  assert.deepEqual(requests, [
    "https://m.mangahere.cc/roll_manga/tsugumomo/v20/c187/1.html",
    "https://www.mangahere.cc/manga/tsugumomo/v20/c187/1.html",
  ]);
});

void test("surfaces a mobile verification challenge before trying another reader", async (t) => {
  let requests = 0;
  const challenge = new CloudflareError({ url: "https://m.mangahere.cc/", method: "GET" });
  t.mock.method(application, "scheduleRequest", async () => {
    requests++;
    throw challenge;
  });
  await assert.rejects(MangaHere.getChapterDetails(chapter), (error) => error === challenge);
  assert.equal(requests, 1);
});

void test("rejects a mobile reader containing only placeholders", async (t) => {
  t.mock.method(application, "scheduleRequest", async ({ url }: Request) =>
    reply(url, '<div id="viewer"><img src="/loading.gif"></div>'),
  );
  await assert.rejects(MangaHere.getChapterDetails(chapter), /No reader data/);
});

void test("uses the SDK sleep for transport retries and forwards verification errors", async (t) => {
  let attempts = 0;
  const sleeps: number[] = [];
  t.mock.method(globalThis, "setTimeout", () => {
    throw new Error("The device runtime has no setTimeout");
  });
  t.mock.method(application, "sleep", async (seconds: number) => {
    sleeps.push(seconds);
  });
  t.mock.method(application, "scheduleRequest", async ({ url }: Request) => {
    if (++attempts < 3) throw new Error("Connection dropped");
    return reply(url, "<title>Recovered</title>");
  });
  const $ = await fetchDocument("https://www.mangahere.cc/");
  assert.equal($("title").text(), "Recovered");
  assert.deepEqual(sleeps, [0.4, 0.8]);
  const challenge = new CloudflareError({ url: "https://www.mangahere.cc/", method: "GET" });
  t.mock.method(application, "scheduleRequest", async () => {
    throw challenge;
  });
  await assert.rejects(fetchDocument("https://www.mangahere.cc/"), (error) => error === challenge);
  assert.deepEqual(sleeps, [0.4, 0.8]);
});
