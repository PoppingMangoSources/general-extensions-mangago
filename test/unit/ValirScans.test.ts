/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

import { ContentRating, type Chapter, type Request, type Response } from "@paperback/types";

const application = {
  getState: () => undefined,
  decodeHTMLEntities: (value: string) => value,
  arrayBufferToUTF8String: (value: ArrayBuffer) => new TextDecoder().decode(value),
  scheduleRequest: async (_request: Request): Promise<[Response, ArrayBuffer]> => {
    throw new Error("Unexpected network request");
  },
};
Object.defineProperty(globalThis, "Application", { configurable: true, value: application });

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
const { ValirScans } = await import("../../src/ValirScans/main");
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

void test("pages Trending through the catalogue API and preserves the other carousel sorts", async (t) => {
  const requests: URL[] = [];
  t.mock.method(
    application,
    "scheduleRequest",
    async ({ url }: Request): Promise<[Response, ArrayBuffer]> => {
      const request = new URL(url);
      requests.push(request);
      const page = Number(request.searchParams.get("page"));
      return [
        { url, status: 200, headers: {}, cookies: [] },
        new TextEncoder().encode(
          JSON.stringify({
            data: [
              {
                slug: `title-${page}`,
                title: `Title ${page}`,
                coverImage: "https://valirscans.org/cover.webp",
              },
            ],
            meta: { hasMore: page === 1 },
          }),
        ).buffer,
      ];
    },
  );
  const sections = await ValirScans.getDiscoverSections();
  const featured = sections.find((section) => section.id === "featured");
  assert.ok(featured);
  assert.equal(featured.title, "Trending");
  assert.ok(featured.subtitle);
  const first = await ValirScans.getDiscoverSectionItems(featured, undefined);
  assert.deepEqual(first.metadata, { page: 2 });
  assert.equal(first.items[0].type, "featuredCarouselItem");
  assert.equal(first.items[0].mangaId, "comic/title-1");
  const second = await ValirScans.getDiscoverSectionItems(featured, first.metadata);
  assert.equal(second.metadata, undefined);
  assert.equal(second.items[0].type, "featuredCarouselItem");
  assert.equal(second.items[0].mangaId, "comic/title-2");
  for (const id of ["top-rated", "new-series"]) {
    const section = sections.find((candidate) => candidate.id === id);
    assert.ok(section);
    await ValirScans.getDiscoverSectionItems(section, undefined);
  }
  assert.deepEqual(
    requests.map((request) => [
      request.pathname,
      request.searchParams.get("sort"),
      request.searchParams.get("page"),
      request.searchParams.get("order"),
    ]),
    [
      ["/api/series", "trending", "1", "desc"],
      ["/api/series", "trending", "2", "desc"],
      ["/api/series", "rating", "1", "desc"],
      ["/api/series", "newest", "1", "desc"],
    ],
  );
});
