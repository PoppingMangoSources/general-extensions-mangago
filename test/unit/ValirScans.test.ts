/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

import { ContentRating, type Chapter } from "@paperback/types";

Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: { getState: () => undefined },
});

const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/ValirScans/forms/") && url.endsWith(".ts")) {
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
const { parseChapterDetails } = await import("../../src/ValirScans/parsers");
hook.deregister();

const chapter: Chapter = {
  chapterId: "7",
  chapNum: 7,
  volume: 0,
  title: "",
  langCode: "en",
  sourceManga: {
    mangaId: "comic/the-convenient-empress-resigns",
    mangaInfo: {
      primaryTitle: "The Convenient Empress Resigns",
      secondaryTitles: [],
      thumbnailUrl: "https://valirscans.org/cover.webp",
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
    },
  },
};

const pages = [
  { pageNumber: 2, imageUrl: "https://media.valirscans.org/second.webp" },
  { pageNumber: 1, imageUrl: "https://media.valirscans.org/first.webp" },
];

void test("reads current and earlier reader props from raw and embedded Flight data", () => {
  for (const reader of [
    { kind: "comic", chapter: { pages, content: "" }, isUnlocked: true, isLocked: false },
    { chapter: { pages, content: "" }, isUnlocked: true, isLocked: false },
  ]) {
    const payload = `1:{"chapter":{"id":"audio-metadata"}}\n2:${JSON.stringify(reader)}\n`;
    const middle = Math.floor(payload.length / 2);
    const html = [payload.slice(0, middle), payload.slice(middle)]
      .map((chunk) => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`)
      .join("");
    for (const data of [payload, html]) {
      assert.deepEqual(parseChapterDetails(data, chapter), {
        id: "7",
        mangaId: chapter.sourceManga.mangaId,
        pages: [
          "https://media.valirscans.org/first.webp",
          "https://media.valirscans.org/second.webp",
        ],
      });
    }
  }
});

void test("reads a novel's referenced UTF-8 prose with the current reader props", () => {
  const content = "<p>Héllo 🌸<br>Next</p>";
  const reader = { kind: "novel", chapter: { content: "$ab", pages: [] }, isUnlocked: true };
  const payload = `1:${JSON.stringify(reader)}\nab:T${new TextEncoder().encode(content).length.toString(16)},${content}`;
  const result = parseChapterDetails(payload, chapter);
  assert.equal(result.type, "html");
  assert.equal(
    result.html,
    '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>Héllo 🌸<br />Next</p></body></html>',
  );
});

void test("rejects locked and empty readers with current props", () => {
  const reader = { kind: "comic", chapter: { pages }, isUnlocked: false, isLocked: true };
  assert.throws(() => parseChapterDetails(JSON.stringify(reader), chapter), /chapter is locked/);
  const unlocked = parseChapterDetails(JSON.stringify({ ...reader, isUnlocked: true }), chapter);
  assert.ok("pages" in unlocked);
  assert.deepEqual(unlocked.pages, [
    "https://media.valirscans.org/first.webp",
    "https://media.valirscans.org/second.webp",
  ]);
  assert.throws(
    () => parseChapterDetails('{"kind":"comic","chapter":{"pages":[]}}', chapter),
    /has no readable content/,
  );
});
