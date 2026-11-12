/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Chapter } from "@paperback/types";
import * as cheerio from "cheerio";

import { parseChapterDetails } from "../../src/RinkoComics/parsers";

Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: {
    arrayBufferToUTF8String: (data: ArrayBuffer) => new TextDecoder().decode(data),
  },
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
