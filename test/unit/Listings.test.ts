/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
import assert from "node:assert/strict";
import test from "node:test";

import { formatCount, formatListingSubtitle } from "../../src/utils/listings";
void test("ordinary subtitles prioritize actual latest chapters, then type or rating", () => {
  assert.equal(
    formatListingSubtitle({
      chapter: 23,
      type: "Novel",
      rating: 9.2,
      views: 67300000,
      follows: 4200,
    }),
    "Ch. 23 • Novel",
  );
  assert.equal(
    formatListingSubtitle({ chapter: 23, rating: 9.2, views: 67300000 }),
    "Ch. 23 • ★ 9.2",
  );
  assert.equal(formatListingSubtitle({ chapter: 0, rating: 0 }), "Ch. 0");
  assert.equal(formatListingSubtitle({ chapter: 1.5, views: 67300000 }), "Ch. 1.5 • ▶︎ 67.3M");
  assert.equal(formatListingSubtitle({ chapterCount: 23, type: "Manga" }), "23 Chs • Manga");
  assert.equal(
    formatListingSubtitle({ chapter: 7, chapterCount: 23, type: "Manhwa" }),
    "Ch. 7 • Manhwa",
  );
  assert.equal(formatListingSubtitle({}), undefined);
  assert.equal(formatListingSubtitle({ chapter: null, rating: null }), undefined);
});
void test("metric numbers are compact and labels never repeat their icon", () => {
  assert.equal(formatCount("17.2 K"), "17.2K");
  assert.equal(formatCount("242,822"), "242.8K");
  assert.equal(formatCount(67300000), "67.3M");
  assert.equal(formatCount(1000000), "1M");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(undefined), undefined);
});
