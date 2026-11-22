/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Chapter } from "@paperback/types";
import * as cheerio from "cheerio";
import { decodeHTML } from "entities";

import {
  parseChapterDetails,
  toHotItems,
  toLatestItems,
  toPinnedItems,
  toNovelItems,
  parseComicCards,
  parseChapterElements,
  finalizeChapters,
} from "../../src/RinkoComics/parsers";

Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: {
    decodeHTMLEntities: decodeHTML,
    arrayBufferToUTF8String: (data: ArrayBuffer) => new TextDecoder().decode(data),
  },
});

void test("current home selects one hero per slide and the first readable release", () => {
  const $ =
    cheerio.load(`<div data-cw-slider><div data-slide><img src="/cover.webp"><h2>Hero</h2><h2>Hero</h2><p>Synopsis</p><span class="chip">Fantasy</span><a href="/comic/example/">Read</a></div></div>
    <section aria-labelledby="cw-week-m"><a href="/comic/featured/"><img src="/featured.webp"><span class="line-clamp-2">Featured</span></a></section>
    <section aria-labelledby="cw-novels"><a class="group" href="/novel/new/"><img src="/novel.webp"><span class="line-clamp-2">New novel</span></a></section>
    <section id="cw-latest"><article><a class="line-clamp-2" href="/comic/example/">Example</a><img src="/cover.webp">
      <a class="chapter-item is-locked" href="#" data-reason="login_required"><span>Ch. 2</span><span>1h</span></a>
      <a class="chapter-item" href="/chapter/example-chapter-0/"><span>Ch. 0</span><span>2h</span></a>
    </article></section>`);
  const heroes = toHotItems($);
  assert.equal(heroes.length, 1);
  assert.equal(heroes[0].type === "featuredCarouselItem" && heroes[0].summary, "Synopsis");
  assert.equal(toPinnedItems($)[0].type, "prominentCarouselItem");
  assert.equal(toNovelItems($)[0].type, "simpleCarouselItem");
  const updates = toLatestItems($);
  assert.equal(updates.length, 1);
  assert.ok(updates[0].type === "chapterUpdatesCarouselItem");
  assert.equal(updates[0].chapterId, "chapter/example-chapter-0");
  assert.equal(updates[0].subtitle, "Ch. 0");
  assert.ok(updates[0].publishDate instanceof Date);
  assert.ok(Math.abs(Date.now() - updates[0].publishDate.getTime() - 7200000) < 2000);
  assert.deepEqual(
    toLatestItems(
      cheerio.load('<section id="cw-latest">No new chapters in the last 24 hours yet.</section>'),
    ),
    [],
  );
});

void test("new browse title excludes badges and new chapter rows preserve zero and locks", () => {
  const cards = parseComicCards(
    cheerio.load(
      '<form id="cwBrowse"><ul><li><a href="/comic/example/"><img src="/cover.webp"><span>Ch. 20</span><span class="line-clamp-2">Example</span></a></li></ul></form>',
    ),
  );
  assert.equal(cards[0].title, "Example");
  const $ = cheerio.load(
    '<div id="cwChapters"><a class="chapter-item is-locked" data-title="7 Years of Love Chapter 2" data-permalink="/chapter/example-chapter-2/" href="#"><span><span>Chapter 2</span><span>Nov 20, 2026 · 17 views</span></span></a><a class="chapter-item" href="/chapter/example-chapter-0/"><span><span>Chapter 0</span><span>Nov 19, 2026 · 8 views</span></span></a></div>',
  );
  const chapters = finalizeChapters(
    parseChapterElements($, $("a.chapter-item"), chapter.sourceManga),
  );
  assert.deepEqual(
    chapters.map((c) => [c.chapterId, c.chapNum]),
    [
      ["chapter/example-chapter-2#lock", 2],
      ["chapter/example-chapter-0", 0],
    ],
  );
  assert.equal(chapters[0].publishDate?.toISOString(), "2026-11-20T00:00:00.000Z");
  const prose = parseChapterDetails(
    cheerio.load('<div id="cwNovelText"><p>A &amp; B<br>Next.</p></div>'),
    chapter,
  );
  assert.equal(prose.type, "html");
});
const chapter: Chapter = {
  chapterId: "chapter/example-chapter-2/",
  chapNum: 2,
  volume: 0,
  langCode: "en",
  sourceManga: {
    mangaId: "comic/example/",
    mangaInfo: {
      primaryTitle: "Example",
      secondaryTitles: [],
      thumbnailUrl: "https://cdn.example/cover.webp",
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
    },
  },
};
const encode = (value: unknown): string => {
  const mask = Buffer.from("0123456789abcdef");
  const bytes = Buffer.from(JSON.stringify(value));
  return Buffer.concat([mask, bytes.map((byte, index) => byte ^ mask[index % 16])]).toString(
    "base64",
  );
};

void test("reads the canvas reader's encoded list in page order without changing IDs", () => {
  const pages = ["https://cdn.example/01.webp", "https://cdn.example/02.webp?name=%E2%99%A5"];
  const $ = cheerio.load(
    `<canvas class="chapter-image" data-page="1"></canvas><script id="cwPages" type="application/json">${encode(pages)}</script>`,
  );
  assert.deepEqual(parseChapterDetails($, chapter), {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  });
});
void test("keeps legacy image and novel readers working", () => {
  const images = parseChapterDetails(
    cheerio.load('<img class="chapter-image" data-src="https://cdn.example/01.webp">'),
    chapter,
  );
  assert.ok("pages" in images);
  assert.deepEqual(images.pages, ["https://cdn.example/01.webp"]);
  const novel = parseChapterDetails(
    cheerio.load('<div id="textContent"><p>Text<br>more.</p></div>'),
    chapter,
  );
  assert.equal(novel.type, "html");
});
void test("rejects malformed lists and reports empty readers without inventing a lock", () => {
  for (const encoded of [
    "!invalid",
    "YQ==",
    encode({ pages: [] }),
    encode([]),
    encode(["javascript:alert(1)"]),
  ]) {
    assert.throws(() =>
      parseChapterDetails(cheerio.load(`<script id="cwPages">${encoded}</script>`), chapter),
    );
  }
  assert.throws(
    () => parseChapterDetails(cheerio.load("<p>No reader</p>"), chapter),
    /no readable pages or text/,
  );
});
