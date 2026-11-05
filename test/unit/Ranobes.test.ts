/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

import { CloudflareError, type Chapter, type Request, type Response } from "@paperback/types";
import * as cheerio from "cheerio";

const state = new Map<string, unknown>();
const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;
const application = {
  getState: (key: string) => state.get(key),
  setState: (value: unknown, key: string) => state.set(key, value),
  arrayBufferToUTF8String: (buffer: ArrayBuffer) => new TextDecoder().decode(buffer),
  decodeHTMLEntities: (text: string) => text,
  getDefaultUserAgent: async () => "Ranobes test browser",
  scheduleRequest: async (_request: Request): Promise<[Response, ArrayBuffer]> => {
    throw new Error("Unexpected network request");
  },
};
Object.defineProperty(globalThis, "Application", { configurable: true, value: application });

// Load the SDK form classes with the same parameter-property transform as the bundler.
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/Ranobes/forms/") && url.endsWith(".ts")) {
      return {
        format: "module",
        shortCircuit: true,
        source: Reflect.apply(stripTypeScriptTypes, undefined, [
          readFileSync(new URL(url), "utf8"),
          { mode: "transform", sourceUrl: url },
        ]),
      };
    }
    return nextLoad(url, context);
  },
});
const { Ranobes } = await import("../../src/Ranobes/main");
hook.deregister();
const { RanobesInterceptor, cookieStorage } = await import("../../src/Ranobes/network");
const { parseChapterDetails, parseChapterPage, parseListings, parseMangaDetails } =
  await import("../../src/Ranobes/parsers");

const chapterListUrl = "https://ranobes.net/chapters/123/";
const request: Request = { url: chapterListUrl, method: "GET" };
const response = (url: string, status: number, headers: Record<string, string> = {}): Response => ({
  url,
  status,
  headers: { "content-type": "text/html", ...headers },
  cookies: [],
});
const manga = parseMangaDetails(
  cheerio.load('<h1 class="title">Test Novel</h1>'),
  "https://ranobes.net/novels/123-test-novel.html",
);

void test("opens the challenged chapter-list URL on the observed DDoS-Guard response", async () => {
  const interceptor = new RanobesInterceptor("test-ranobes");
  const finalUrl = `${chapterListUrl}page/4/`;
  const body = encode(
    '<title>Just a moment...</title><div id="vb-captcha-shell" class="vb-custom-captcha-shell"></div>',
  );
  await assert.rejects(
    interceptor.interceptResponse(request, response(finalUrl, 503, { server: "ddos-guard" }), body),
    (error: unknown) =>
      error instanceof CloudflareError &&
      error.resolutionRequest.url === finalUrl &&
      error.resolutionRequest.method === "GET" &&
      error.resolutionRequest.headers?.["user-agent"] === "Ranobes test browser",
  );
  await assert.rejects(
    interceptor.interceptResponse(
      request,
      response(request.url, 403, { "CF-Mitigated": "challenge" }),
      encode(""),
    ),
    CloudflareError,
  );
});

void test("passes ordinary chapter text and plain denials through the challenge detector", async () => {
  const interceptor = new RanobesInterceptor("test-ranobes");
  const prose = encode('<div id="arrticle">She was checking your browser.</div>');
  const denied = encode("<title>Access denied</title>");
  assert.equal(
    await interceptor.interceptResponse(request, response(request.url, 200), prose),
    prose,
  );
  assert.equal(
    await interceptor.interceptResponse(
      request,
      response(request.url, 403, { server: "ddos-guard" }),
      denied,
    ),
    denied,
  );
});

void test("verification cookies reach matching chapter requests through the SDK store", async () => {
  await Ranobes.cloudflareBypassCompleted(
    request,
    [{ name: "__ddg_test_", value: "fixture", domain: ".ranobes.net", path: "/chapters/" }],
    {},
  );
  try {
    assert.deepEqual((await cookieStorage.interceptRequest({ ...request })).cookies, {
      __ddg_test_: "fixture",
    });
    assert.deepEqual(
      (await cookieStorage.interceptRequest({ ...request, url: "https://ranobes.net/novels/" }))
        .cookies,
      {},
    );
  } finally {
    cookieStorage.cookies = [];
  }
});

void test("fetches real chapter pages sequentially and refreshes from page one", async (t) => {
  const calls: string[] = [];
  let active = 0;
  let latest = 5;
  t.mock.method(application, "scheduleRequest", async ({ url }: Request) => {
    assert.equal(active++, 0);
    calls.push(url);
    await Promise.resolve();
    const page = Number(/\/page\/(\d+)\//.exec(url)?.[1] ?? 1);
    const number = page === 1 ? latest : 4 - page;
    active--;
    return [
      response(url, 200),
      encode(
        `<script>window.__DATA__ = ${JSON.stringify({
          chapters: [{ link: `/test-novel-123/${number}.html`, title: `Chapter ${number}: Test` }],
          cstart: String(page),
          ...(page === 1 ? { pages_count: "4", count_all: 4 } : {}),
        })};</script>`,
      ),
    ];
  });
  const first = await Ranobes.getChapters(manga);
  assert.deepEqual(
    first.map((c) => c.chapNum),
    [5, 2, 1, 0],
  );
  assert.equal(first[3].chapterId, "https://ranobes.net/test-novel-123/0.html");
  latest = 6;
  assert.deepEqual(
    (await Ranobes.getChapters(manga)).map((c) => c.chapNum),
    [6, 2, 1, 0],
  );
  assert.deepEqual(calls, [
    chapterListUrl,
    `${chapterListUrl}page/2/`,
    `${chapterListUrl}page/3/`,
    `${chapterListUrl}page/4/`,
    chapterListUrl,
    `${chapterListUrl}page/2/`,
    `${chapterListUrl}page/3/`,
    `${chapterListUrl}page/4/`,
  ]);
});

void test("rejects malformed chapter pages before scheduling more requests", () => {
  const page = (value: unknown) =>
    cheerio.load(`<script>window.__DATA__ = ${JSON.stringify(value)};</script>`);
  assert.throws(
    () => parseChapterPage(page({ unrelated: true })),
    /invalid or empty chapter-list page/,
  );
  assert.throws(
    () => parseChapterPage(page({ chapters: [{ link: "", title: "Test" }] })),
    /invalid or empty chapter-list page/,
  );
  assert.throws(
    () =>
      parseChapterPage(
        page({ chapters: [{ link: "/test/1.html", title: "Test" }], pages_count: -1 }),
      ),
    /invalid chapter pagination field pages_count/,
  );
});

void test("skips coverless cards and keeps a real lazy-loaded GIF in the reader", () => {
  const cards = parseListings(
    cheerio.load(`
    <article class="block story shortstory"><h2 class="title"><a href="/novels/1-empty.html">Empty</a></h2></article>
    <article class="block story shortstory"><h2 class="title"><a href="/novels/123-test-novel.html">Test</a></h2>
    <figure class="cover"><img src="/placeholder.png" data-src="/real.gif"></figure></article>`),
    "stories",
  );
  assert.deepEqual(
    cards.map((c) => c.imageUrl),
    ["https://ranobes.net/real.gif"],
  );
  assert.equal(cards[0].rating, undefined);
  assert.match(manga.mangaInfo.thumbnailUrl, /^https:\/\/.+\/Ranobes\/static\/icon\.png$/);
  const details = parseChapterDetails(
    cheerio.load(
      '<div id="arrticle"><p><em>Test</em><br><img src="/placeholder.png" data-src="/real.gif"></p></div>',
    ),
    {
      chapterId: "https://ranobes.net/test-novel-123/0.html",
      sourceManga: manga,
    } as Chapter,
  );
  assert.ok("html" in details);
  assert.match(
    details.html,
    /<em>Test<\/em><br\s*\/><img src="https:\/\/ranobes\.net\/real\.gif"\s*\/>/,
  );
});
