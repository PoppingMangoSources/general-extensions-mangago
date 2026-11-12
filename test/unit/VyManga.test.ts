/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

import { ContentRating, type Chapter, type Request, type Response } from "@paperback/types";

const application = {
  getState: (_key: string): unknown => undefined,
  decodeHTMLEntities: (value: string) => value,
  arrayBufferToUTF8String: (data: ArrayBuffer) => new TextDecoder().decode(data),
  scheduleRequest: async (_request: Request): Promise<[Response, ArrayBuffer]> => {
    throw new Error("Unexpected network request");
  },
};
Object.defineProperty(globalThis, "Application", { configurable: true, value: application });
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/VyManga/") && url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: Reflect.apply(stripTypeScriptTypes, undefined, [
          readFileSync(new URL(url), "utf8"),
          { mode: "transform", sourceUrl: url },
        ]),
      };
    return nextLoad(url, context);
  },
});
const { VyManga } = await import("../../src/VyManga/main");
hook.deregister();
const chapter: Chapter = {
  chapterId: "https://aovheroes.com/rds/br/rdsd?data=expired",
  chapNum: 1,
  title: "Vol.1 Chapter 1",
  langCode: "en",
  volume: 0,
  sourceManga: {
    mangaId: "example",
    mangaInfo: {
      primaryTitle: "Example",
      secondaryTitles: [],
      thumbnailUrl: "https://example.com/cover.jpg",
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
    },
  },
};
const reply = (url: string, body: string): [Response, ArrayBuffer] => [
  { url, status: 200, headers: {}, cookies: [] },
  new TextEncoder().encode(body).buffer,
];
const row =
  '<a class="list-chapter" href="https://aovheroes.com/rds/br/rdsd?data=fresh"><span>Vol.1 Chapter 1</span><p class="small">January 1, 2026</p></a>';

void test("refreshes expiring reader links while returning the original saved chapter ID", async (t) => {
  const requests: string[] = [];
  t.mock.method(application, "scheduleRequest", async (request: Request) => {
    requests.push(request.url);
    return reply(
      request.url,
      requests.length === 1 ? row : '<img class="d-block" data-src="https://cdn.example/01.jpg">',
    );
  });
  assert.deepEqual(await VyManga.getChapterDetails(chapter), {
    id: chapter.chapterId,
    mangaId: "example",
    pages: ["https://cdn.example/01.jpg"],
  });
  assert.deepEqual(requests, [
    "https://mangavyvy.net/manga/example",
    "https://aovheroes.com/rds/br/rdsd?data=fresh&view=0",
  ]);
});
void test("does not substitute an ambiguous or missing chapter after refreshing links", async (t) => {
  for (const html of ["<p>No chapters</p>", row + row.replace("data=fresh", "data=other")]) {
    let requests = 0;
    t.mock.method(application, "scheduleRequest", async (request: Request) => {
      requests++;
      return reply(request.url, html);
    });
    await assert.rejects(VyManga.getChapterDetails(chapter), /refresh.*chapter link/i);
    assert.equal(requests, 1);
  }
});
