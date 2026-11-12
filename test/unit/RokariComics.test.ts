/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

import { ContentRating, type Chapter, type Request, type Response } from "@paperback/types";
import * as cheerio from "cheerio";

const state: Record<string, unknown> = {};
const application = {
  getState: (key: string) => state[key],
  decodeHTMLEntities: (value: string) => value,
  arrayBufferToUTF8String: (data: ArrayBuffer) => new TextDecoder().decode(data),
  scheduleRequest: async (_request: Request): Promise<[Response, ArrayBuffer]> => {
    throw new Error("Unexpected network request");
  },
};
Object.defineProperty(globalThis, "Application", { configurable: true, value: application });
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/RokariComics/") && url.endsWith(".ts"))
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
const { RokariComics } = await import("../../src/RokariComics/main");
hook.deregister();
const chapter: Chapter = {
  chapterId: "2",
  chapNum: 2,
  langCode: "en",
  volume: 0,
  sourceManga: {
    mangaId: "the-golden-handed-baby-fixes-everything",
    mangaInfo: {
      primaryTitle: "Example",
      secondaryTitles: [],
      thumbnailUrl: "https://example.com/cover.jpg",
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
    },
  },
};
const reader =
  '<script>ts_reader.run({"sources":[{"images":["https://rokaricomics.com/page.jpg"]}]});</script>';
const reply = (url: string, html: string): [Response, ArrayBuffer] => [
  { url, status: 200, headers: {}, cookies: [] },
  new TextEncoder().encode(html).buffer,
];

void test("opens numeric chapters directly while preserving saved IDs and post-ID settings", async (t) => {
  const requests: string[] = [];
  t.mock.method(application, "scheduleRequest", async (request: Request) => {
    requests.push(request.url);
    return reply(request.url, reader);
  });
  for (const postIds of [false, true]) {
    state.postIds = String(postIds);
    state["123"] = chapter.sourceManga.mangaId;
    const input = postIds
      ? { ...chapter, sourceManga: { ...chapter.sourceManga, mangaId: "123" } }
      : chapter;
    assert.deepEqual(await RokariComics.getChapterDetails(input), {
      id: "2",
      mangaId: input.sourceManga.mangaId,
      pages: ["https://rokaricomics.com/page.jpg"],
    });
  }
  assert.deepEqual(
    requests,
    Array(2).fill("https://rokaricomics.com/the-golden-handed-baby-fixes-everything-chapter-2/"),
  );
});
void test("keeps the existing lookup when a numeric library ID has no saved slug", async (t) => {
  state.postIds = "true";
  delete state["123"];
  const requests: string[] = [];
  t.mock.method(application, "scheduleRequest", async (request: Request) => {
    requests.push(request.url);
    return reply(
      request.url,
      requests.length === 1
        ? '<div id="chapterlist"><li data-num="2"><a href="https://rokaricomics.com/irregular-chapter/">Chapter 2</a></li></div>'
        : reader,
    );
  });
  await RokariComics.getChapterDetails({
    ...chapter,
    sourceManga: { ...chapter.sourceManga, mangaId: "123" },
  });
  assert.deepEqual(requests, [
    "https://rokaricomics.com/?p=123/",
    "https://rokaricomics.com/irregular-chapter/",
  ]);
});
void test("keeps locked chapters guarded and respects their visibility setting", async () => {
  state.postIds = "false";
  const $ = cheerio.load(
    '<div id="chapterlist"><li data-num="2"><span class="chapternum">Chapter 2</span><span class="chapterdate">January 2, 2026</span><span class="text-gold"></span></li><li data-num="1"><span class="chapternum">Chapter 1</span><span class="chapterdate">January 1, 2026</span></li></div>',
  );
  state.rokaricomics_show_locked_chapters = undefined;
  assert.equal(
    RokariComics.parser.parseChapterList($, chapter.sourceManga, RokariComics).length,
    1,
  );
  state.rokaricomics_show_locked_chapters = true;
  const chapters = RokariComics.parser.parseChapterList($, chapter.sourceManga, RokariComics);
  assert.equal(chapters[0].chapterId, "2#locked");
  await assert.rejects(RokariComics.getChapterDetails(chapters[0]), /locked/);
});

void test("preserves percent-encoded image paths and signed query values", () => {
  const url = "https://rokaricomics.com/a%20b.jpg?signature=a%2Fb%3D";
  const $ = cheerio.load(
    `<script>ts_reader.run(${JSON.stringify({ sources: [{ images: [url] }] })});</script>`,
  );
  const details = RokariComics.parser.parseChapterDetails($, chapter);
  assert.ok("pages" in details);
  assert.deepEqual(details.pages, [url]);
});
