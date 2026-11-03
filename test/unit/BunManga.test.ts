/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { CloudflareError, type Request } from "@paperback/types";
import * as cheerio from "cheerio";

import { MIRRORS, STATE_KEYS } from "../../src/BunManga/models";
import {
  BunMangaInterceptor,
  fetchMangaPage,
  fetchReaderPage,
  fetchChapterList,
  fetchHomePage,
  fetchSearchPage,
} from "../../src/BunManga/network";
import { parsePopular, parseTopDaily } from "../../src/BunManga/parsers";

const mockApi = (
  t: TestContext,
  reply: (request: Request) => { status: number; body?: string } | never,
) => {
  const requests: Request[] = [];
  const state: Record<string, unknown> = {};
  const original = Object.getOwnPropertyDescriptor(globalThis, "Application");
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: {
      getState: (key: string) => state[key],
      setState: (value: unknown, key: string) => {
        state[key] = value;
      },
      decodeHTMLEntities: (text: string) => text,
      getDefaultUserAgent: async () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
      arrayBufferToUTF8String: (data: ArrayBuffer) => Buffer.from(data).toString(),
      scheduleRequest: async (request: Request) => {
        requests.push(request);
        const result = reply(request);
        return [
          { status: result.status },
          Uint8Array.from(Buffer.from(result.body ?? "<p>Ready</p>")).buffer,
        ];
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "Application", original);
    else Reflect.deleteProperty(globalThis, "Application");
  });
  return { requests, state };
};

void test("BunManga uses canonical paths and sticks to a successful mirror for subsequent calls", async (t) => {
  let failed = MIRRORS[0];
  const { requests, state } = mockApi(t, (request) => ({
    status: request.url.startsWith(failed) ? 503 : 200,
  }));
  await fetchMangaPage("the-night-watcher");
  assert.equal(requests[0].url, "https://bunmanga.com/manga/the-night-watcher/");
  assert.equal(requests[1].url, "https://manhuahot.com/manga/the-night-watcher/");
  assert.equal(state[STATE_KEYS.ACTIVE_BASE_URL], MIRRORS[1]);
  await fetchChapterList("the-night-watcher");
  assert.equal(requests[2].url, "https://manhuahot.com/manga/the-night-watcher/ajax/chapters/");
  assert.equal(requests[2].method, "POST");
  assert.equal(requests[2].body, "");
  assert.equal(requests[2].headers?.referer, "https://manhuahot.com/manga/the-night-watcher/");
  await fetchReaderPage("the-night-watcher", "chap-12");
  assert.equal(
    requests[3].url,
    "https://manhuahot.com/manga/the-night-watcher/chap-12/?style=list",
  );
  failed = MIRRORS[1];
  await fetchHomePage();
  assert.equal(state[STATE_KEYS.ACTIVE_BASE_URL], MIRRORS[0]);
  assert.equal(requests.length, 6);
});

void test("BunManga mirror search translates verified genre slugs and uses public page URLs", async (t) => {
  const { requests } = mockApi(t, (request) => ({
    status: request.url.startsWith(MIRRORS[0]) ? 503 : 200,
  }));
  await fetchSearchPage({ title: "watcher", genres: ["romance", "bl"], sortBy: "rating" }, 2);
  const url = new globalThis.URL(requests[1].url);
  assert.equal(url.pathname, "/page/2/");
  assert.equal(url.searchParams.get("s"), "watcher");
  assert.equal(url.searchParams.get("m_orderby"), "rating");
  assert.deepEqual(url.searchParams.getAll("genre[]"), ["romances", "bl"]);
  assert.equal(requests[1].method, "GET");
});

void test("BunManga failover handles challenges without hiding them when both hosts fail", async (t) => {
  let bothFailed = false;
  const challenge = new CloudflareError({ url: `${MIRRORS[0]}/`, method: "GET" });
  const { state } = mockApi(t, (request) => {
    if (bothFailed || request.url.startsWith(MIRRORS[0])) throw challenge;
    return { status: 200 };
  });
  await fetchHomePage();
  assert.equal(state[STATE_KEYS.ACTIVE_BASE_URL], MIRRORS[1]);
  bothFailed = true;
  await assert.rejects(fetchHomePage(), (error) => error === challenge);
});

void test("BunManga does not retry an invalid request on every mirror", async (t) => {
  const { requests } = mockApi(t, () => ({ status: 400 }));
  await assert.rejects(fetchHomePage(), /status 400/);
  assert.equal(requests.length, 1);
});

void test("BunManga reports a password lock without treating it as a mirror outage", async (t) => {
  const { requests } = mockApi(t, () => ({
    status: 403,
    body: '<div class="mhcl-lock-box"><h1>Chapter Locked</h1></div>',
  }));
  await assert.rejects(fetchReaderPage("the-night-watcher", "chap-12"), /password protected/);
  assert.equal(requests.length, 1);
});

void test("BunManga uses one Safari identity and opens AJAX challenges at the mirror root", async (t) => {
  mockApi(t, () => ({ status: 200 }));
  const interceptor = new BunMangaInterceptor("test");
  const request = await interceptor.interceptRequest({
    url: `${MIRRORS[1]}/manga/test/`,
    method: "GET",
  });
  assert.equal(request.headers?.origin, MIRRORS[1]);
  assert.equal(request.headers?.referer, `${MIRRORS[1]}/`);
  assert.match(request.headers?.["user-agent"] ?? "", /Version\/18.0 Mobile\/15E148 Safari\/604.1/);
  await assert.rejects(
    interceptor.interceptResponse(
      { url: `${MIRRORS[1]}/manga/test/ajax/chapters/`, method: "POST" },
      { status: 403, headers: { "CF-Mitigated": "challenge" }, url: request.url, cookies: [] },
      new ArrayBuffer(0),
    ),
    CloudflareError,
  );
});

void test("BunManga Popular keeps its slider and the ManhuaHot slider supplies mirror highlights", (t) => {
  mockApi(t, () => ({ status: 200 }));
  const markup = (heading: string) =>
    cheerio.load(
      `<div class="widget-manga-popular-slider"><h5 class="heading">${heading}</h5><div class="slider__item"><div class="slider__thumb"><img src="https://images.test/cover.jpg" /></div><div class="post-title"><a href="/manga/site-popular/">Site Popular</a></div></div></div><div class="widget-manga-recent"><h5 class="heading">LATEST UPDATE</h5></div>`,
    );
  assert.deepEqual(
    parsePopular(markup("POPULAR")).map((item) => item.mangaId),
    ["site-popular"],
  );
  assert.deepEqual(
    parsePopular(markup("Top Daily")).map((item) => item.mangaId),
    ["site-popular"],
  );
  assert.deepEqual(
    parseTopDaily(markup("Top Daily")).map((item) => item.mangaId),
    ["site-popular"],
  );
});
