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
  sleep: async () => {},
  executeInWebView: async (
    _context: Application.ExecuteInWebViewContext,
  ): Promise<Application.WebViewExecutionResult> => ({ result: [], storage: { cookies: [] } }),
  scheduleRequest: async (_request: Request): Promise<[Response, ArrayBuffer]> => {
    throw new Error("Unexpected network request");
  },
};
Object.defineProperty(globalThis, "Application", { configurable: true, value: application });

// Load the SDK form classes with the same parameter-property transform as the bundler.
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/RanobesWebView/forms/") && url.endsWith(".ts")) {
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
const { RanobesWebView: Ranobes } = await import("../../src/RanobesWebView/main");
hook.deregister();
const { buildSearchPath, RanobesInterceptor, cookieStorage, fetchHtml, resetVerificationPrompt } =
  await import("../../src/RanobesWebView/network");
const {
  parseChapterDetails,
  parseChapterPage,
  parseFilterTaxonomy,
  parseListings,
  parseMangaDetails,
} = await import("../../src/RanobesWebView/parsers");

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

void test("opens the challenged chapter-list URL on the observed DDoS-Guard response", async (t) => {
  t.after(resetVerificationPrompt);
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
  resetVerificationPrompt();
  await assert.rejects(
    interceptor.interceptResponse(
      request,
      response(request.url, 403, { "CF-Mitigated": "challenge" }),
      encode(""),
    ),
    CloudflareError,
  );
});

void test("concurrent Discover requests queue only one verification prompt", async (t) => {
  const interceptor = new RanobesInterceptor("test-ranobes");
  t.after(resetVerificationPrompt);
  const calls: string[] = [];
  t.mock.method(application, "scheduleRequest", async (request: Request) => {
    const prepared = await interceptor.interceptRequest(request);
    calls.push(prepared.url);
    const blocked = response(prepared.url, 503);
    const data = await interceptor.interceptResponse(
      prepared,
      blocked,
      encode('<div id="vb-captcha-shell"></div>'),
    );
    return [blocked, data];
  });
  const results = await Promise.allSettled(
    ["/", "/", "/updates/", "/ranking/", "/tags/status-trs/Completed/"].map((path) =>
      fetchHtml(`https://ranobes.net${path}`),
    ),
  );
  assert.equal(results.filter((result) => result.status === "rejected").length, 5);
  assert.equal(
    results.filter(
      (result) => result.status === "rejected" && result.reason instanceof CloudflareError,
    ).length,
    1,
  );
  const callCount = calls.length;
  await assert.rejects(fetchHtml(chapterListUrl), /pending Ranobes verification/);
  assert.equal(calls.length, callCount);
  await Ranobes.cloudflareBypassCompleted(request, [], {});
  await assert.rejects(fetchHtml(chapterListUrl), CloudflareError);
  assert.equal(calls.length, callCount + 1);
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
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
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
  now += 90 * 60_000;
  calls.length = 0;
  assert.deepEqual(
    (await Ranobes.getChapters(manga)).map((chapter) => chapter.chapterId),
    first.map((chapter) => chapter.chapterId),
  );
  assert.deepEqual(calls, [chapterListUrl]);
  calls.length = 0;
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
  ]);
});

void test("resumes page 44 after verification and restarts if the chapter list has shifted", async (t) => {
  const calls: number[] = [];
  let blocked = true;
  let shiftBoundary = false;
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  t.mock.method(application, "scheduleRequest", async ({ url }: Request) => {
    const page = Number(/\/page\/(\d+)\//.exec(url)?.[1] ?? 1);
    calls.push(page);
    if (blocked && page === 44) throw new CloudflareError({ url, method: "GET" });
    const number = shiftBoundary && page === 43 ? 46 : 45 - page;
    return [
      response(url, 200),
      encode(
        `<script>window.__DATA__ = ${JSON.stringify({
          chapters: [{ link: `/test-novel-123/${number}.html`, title: `Chapter ${number}: Test` }],
          cstart: page,
          pages_count: 45,
          count_all: 45,
        })};</script>`,
      ),
    ];
  });

  await assert.rejects(Ranobes.getChapters(manga), CloudflareError);
  await Ranobes.cloudflareBypassCompleted(request, [], {});
  blocked = false;
  calls.length = 0;
  assert.equal((await Ranobes.getChapters(manga)).length, 45);
  assert.deepEqual(calls, [1, 43, 44, 45]);

  now += 2 * 60 * 60_000;
  blocked = true;
  await assert.rejects(Ranobes.getChapters(manga), CloudflareError);
  blocked = false;
  shiftBoundary = true;
  calls.length = 0;
  assert.equal((await Ranobes.getChapters(manga)).length, 45);
  assert.deepEqual(calls, [1, 43, ...Array.from({ length: 44 }, (_, index) => index + 2)]);
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
  assert.match(manga.mangaInfo.thumbnailUrl, /^https:\/\/.+\/RanobesWebView\/static\/icon\.png$/);
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

void test("search pickers preserve site option values and send distinct exclusions", () => {
  const taxonomy = parseFilterTaxonomy(
    JSON.stringify({
      genre: ["Drama"],
      events: ["Evil Gods"],
      authors: ["Get Lost", "7 Percent"],
      translater: ["CKtalon"],
      tags: ["3G书城"],
    }),
  );
  assert.deepEqual(taxonomy.genres, [{ id: "Drama", title: "Drama" }]);
  assert.deepEqual(taxonomy.events, [{ id: "Evil%20Gods", title: "Evil Gods" }]);
  assert.equal(taxonomy.authors.length, 2);
  const result = buildSearchPath(
    "reincarn",
    {
      genres: { [taxonomy.genres[0].id]: "included" },
      authors: {
        [taxonomy.authors[0].id]: "included",
        [taxonomy.authors[1].id]: "excluded",
      },
      translators: { [taxonomy.translators[0].id]: "included" },
      publishers: { [taxonomy.publishers[0].id]: "excluded" },
      ratingsFrom: "0",
      ratingsTo: "1000",
      mtlFiles: true,
    },
    { id: "comments_desc", label: "Comments" },
  );
  assert.equal(
    result,
    "/f/l.title=reincarn/n.genre=Drama/f.pvotenum=0/t.pvotenum=1000/n.authors=Get+Lost/v.authors=7+Percent/n.translater=CKtalon/!m.tags=3G%E4%B9%A6%E5%9F%8E/g.mtl_files=1/sort=comm_num/order=desc/",
  );
  assert.equal(
    buildSearchPath("", { authors: "Get Lost", excludedAuthors: "7 Percent" }, undefined),
    "/f/n.authors=Get+Lost/v.authors=7+Percent/",
  );
});

void test("chapter lists use a single WebView batch after the first page", async (t) => {
  const session = { name: "session", value: "fixture", domain: ".ranobes.net", path: "/chapters/" };
  const expires = new Date(Date.now() + 60_000);
  cookieStorage.setCookie(session);
  cookieStorage.setCookie({ ...session, name: "persistent", expires });
  t.after(() => {
    cookieStorage.cookies = [];
  });
  const chapterUrl = (page: number) => `${chapterListUrl}page/${page}/`;
  const html = (page: number) =>
    `<script>window.__DATA__ = ${JSON.stringify({
      chapters: [{ link: `/test-novel-123/${page}.html`, title: `Chapter ${page}: Test` }],
      pages_count: 3,
      count_all: 3,
      cstart: page,
    })};</script>`;
  t.mock.method(application, "scheduleRequest", async ({ url }: Request) => {
    assert.equal(url, chapterListUrl);
    return [response(url, 200), encode(html(1))];
  });
  const execute = t.mock.method(
    application,
    "executeInWebView",
    async (context: Application.ExecuteInWebViewContext) => {
      assert.equal(context.source.baseUrl, chapterUrl(2));
      assert.equal(context.source.userAgent, "Ranobes test browser");
      assert.match(context.inject, /window\.__ranobesChapterPages/);
      const cookies = context.storage.cookies;
      assert.ok(cookies.find(({ name }) => name === "session")?.expires instanceof Date);
      assert.deepEqual(cookies.find(({ name }) => name === "persistent")?.expires, expires);
      assert.equal(
        cookieStorage.cookies.find(({ name }) => name === "session")?.expires,
        undefined,
      );
      assert.ok(context.source.html.includes(JSON.stringify([chapterUrl(2), chapterUrl(3)])));
      return { result: [html(2), html(3)], storage: { cookies: [] } };
    },
  );
  assert.deepEqual(
    (await Ranobes.getChapters(manga)).map(({ chapNum }) => chapNum),
    [1, 2, 3],
  );
  assert.equal(execute.mock.callCount(), 1);
});

void test("advanced search fetches and memoizes the site's JSON filter catalogue", async (t) => {
  const url = "https://ranobes.net/engine/mods/dle_filter/ajax.php?action=options";
  const schedule = t.mock.method(application, "scheduleRequest", async (request: Request) => {
    assert.equal(request.url, url);
    assert.equal(request.method, "GET");
    return [
      response(url, 200, { "content-type": "application/json" }),
      encode(
        JSON.stringify({
          genre: ["Drama"],
          events: ["Abandoned Children"],
          authors: ["Get Lost"],
          translater: ["CKtalon"],
          tags: ["Qidian Webnovel"],
        }),
      ),
    ];
  });
  await Ranobes.getAdvancedSearchForm({ title: "" });
  await Ranobes.getAdvancedSearchForm({ title: "" });
  assert.equal(schedule.mock.callCount(), 1);
  assert.throws(
    () => parseFilterTaxonomy('{"genre":["Drama"]}'),
    /invalid filter options for events/,
  );
});

void test("sends the site rating range alongside status and sort", async (t) => {
  const path = "/f/r.prate=4.6%3B5/status-end=Ongoing/sort=date/order=desc/";
  const query = {
    title: "",
    metadata: { starsFrom: 4.600000000000001, originalStatus: "Ongoing" },
  };
  const sorting = { id: "date_desc", label: "New Novels" };
  assert.equal(buildSearchPath(query.title, query.metadata, sorting), path);
  assert.equal(buildSearchPath("", { starsTo: 4 }, undefined), "/f/r.prate=1%3B4/");
  const schedule = t.mock.method(application, "scheduleRequest", async ({ url }: Request) => [
    response(url, 200),
    encode(
      '<div class="navigation"><span class="page_next"><a href="/page/2/">Next</a></span></div>',
    ),
  ]);
  const result = await Ranobes.getSearchResults(query, undefined, sorting);
  assert.equal(schedule.mock.calls[0].arguments[0].url, `https://ranobes.net${path}`);
  assert.deepEqual(result.metadata, { page: 2 });
});
