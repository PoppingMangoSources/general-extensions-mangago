/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Chapter } from "@paperback/types";

import { parseChapterDetails } from "../../src/NovelCool/parsers";

Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: { decodeHTMLEntities: (value: string) => value.replaceAll("&amp;", "&") },
});
const chapter: Chapter = {
  chapterId: "123",
  chapNum: 1,
  langCode: "en",
  volume: 0,
  sourceManga: {
    mangaId: "456",
    mangaInfo: {
      primaryTitle: "Example",
      secondaryTitles: [],
      thumbnailUrl: "https://example.com/cover.jpg",
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
    },
  },
};

void test("preserves encoded image paths and signatures while escaping literal spaces", () => {
  const details = parseChapterDetails(
    {
      id: "123",
      book_id: "456",
      title: "Chapter 1",
      pic_list: [
        { order_id: 2, pic_path: "//cdn.example/a b.jpg?signature=a%2Fb%3D&amp;page=2" },
        { order_id: 1, pic_path: "https://cdn.example/a%20b.jpg?signature=a%2Fb%3D" },
      ],
    },
    chapter,
  );
  assert.ok("pages" in details);
  assert.deepEqual(details.pages, [
    "https://cdn.example/a%20b.jpg?signature=a%2Fb%3D",
    "https://cdn.example/a%20b.jpg?signature=a%2Fb%3D&page=2",
  ]);
});
