/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test, { type TestContext } from "node:test";

import { ContentRating, type Request, type SourceManga } from "@paperback/types";

import { STATE_KEYS, type ChapterData, type ComicData } from "../../src/XCOMIC/models";

registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/XCOMIC/forms/") && url.endsWith(".ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: Reflect.apply(stripTypeScriptTypes, undefined, [
          readFileSync(new globalThis.URL(url), "utf8"),
          { mode: "transform", sourceUrl: url },
        ]),
      };
    return nextLoad(url, context);
  },
});
Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: { getState: () => undefined },
});
const { XCOMIC } = await import("../../src/XCOMIC/main");
const { getMergeEditions, getDeduplicateChapters } =
  await import("../../src/XCOMIC/forms/settings");
const { parseChapterLists, toMergedEditions } = await import("../../src/XCOMIC/parsers");
Reflect.deleteProperty(globalThis, "Application");

const manga: SourceManga = {
  mangaId: "own",
  mangaInfo: {
    primaryTitle: "A work",
    secondaryTitles: [],
    thumbnailUrl: "",
    synopsis: "",
    contentRating: ContentRating.EVERYONE,
  },
};
const chapter = (id: string, number: number | null = 1): ChapterData => ({
  id,
  urlPath: `/chapter/${id}`,
  chaNum: number,
  dbStatus: "normal",
});
const mockApi = (
  t: TestContext,
  reply: (query: string, variables: Record<string, unknown>) => unknown,
  state: Record<string, unknown> = {},
) => {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "Application");
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: {
      getState: (key: string) => state[key],
      setState: (value: unknown, key: string) => {
        state[key] = value;
      },
      decodeHTMLEntities: (text: string) => text,
      arrayBufferToUTF8String: (data: ArrayBuffer) => Buffer.from(data).toString(),
      scheduleRequest: async (request: Request) => {
        assert.ok(typeof request.body === "string");
        const body: { query: string; variables: Record<string, unknown> } = JSON.parse(
          request.body,
        );
        requests.push(body);
        return [
          { status: 200 },
          Uint8Array.from(Buffer.from(JSON.stringify({ data: reply(body.query, body.variables) })))
            .buffer,
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

void test("XCOMIC defaults to separate editions and the server's unique list, and loads all pages", async (t) => {
  const { requests } = mockApi(t, (_query, variables) => ({
    chapterList: {
      paging: { pages: 2, total: 3 },
      items: (Reflect.get(variables.select ?? {}, "page") === 1
        ? [chapter("one"), chapter("two", 2)]
        : [chapter("three", 3)]
      ).map((data) => ({ data })),
    },
  }));
  assert.equal(getMergeEditions(), false);
  assert.equal(getDeduplicateChapters(), true);
  const chapters = await XCOMIC.getChapters(manga);
  assert.deepEqual(
    chapters.map((item) => item.chapterId),
    ["/chapter/three", "/chapter/two", "/chapter/one"],
  );
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => request.query.includes("get_comic_chapterList_uniqList")));
  assert.equal(Reflect.get(requests[0].variables.select ?? {}, "size"), 1000);
});

void test("XCOMIC deduplication can be disabled without changing saved chapter IDs", async (t) => {
  const { requests } = mockApi(
    t,
    () => ({
      chapterList: {
        paging: { pages: 1, total: 2 },
        items: [chapter("original"), chapter("alternate")].map((data) => ({ data })),
      },
    }),
    { [STATE_KEYS.DEDUPLICATE_CHAPTERS]: false },
  );
  assert.equal(getDeduplicateChapters(), false);
  const chapters = await XCOMIC.getChapters(manga);
  assert.deepEqual(
    chapters.map((item) => item.chapterId),
    ["/chapter/original", "/chapter/alternate"],
  );
  assert.match(requests[0].query, /get_comic_chapterList_fullList/);
  assert.equal(Reflect.get(requests[0].variables.select ?? {}, "size"), 600);
});

void test("XCOMIC rejects incomplete chapter lists instead of publishing a partial library update", async (t) => {
  mockApi(t, () => ({
    chapterList: { paging: { pages: 1, total: 3 }, items: [{ data: chapter("one") }] },
  }));
  await assert.rejects(XCOMIC.getChapters(manga), /sent 1 of 3 chapters/);
});

void test("XCOMIC merging retains the opened edition and excludes private, empty and other-language editions", (t) => {
  mockApi(t, () => ({}));
  const own: ComicData = { id: "own", name: "A Work [Team]", translatedLanguage: "en" };
  const siblings: ComicData[] = [
    own,
    { id: "other", name: "A Work [Other]", translatedLanguage: "en" },
    { id: "foreign", name: "A Work", translatedLanguage: "fr" },
    { id: "private", name: "A Work", isPublic: false },
    { id: "deleted", name: "A Work", dbStatus: "deleted" },
    { id: "empty", name: "A Work", chaps_normal: 0 },
  ];
  assert.deepEqual(
    toMergedEditions(
      { data: { ...own, work: { comicNodes: siblings.map((data) => ({ data })) } } },
      ["en"],
    ).map((item) => item.id),
    ["own", "other"],
  );
});

void test("XCOMIC merging deduplicates a team's repeated editions without dropping other teams, parts, volumes or extras", (t) => {
  mockApi(t, () => ({}));
  const team = (id: string, name: string): ComicData => ({
    id,
    name: "A Work",
    subName: name,
    translatedLanguage: "en",
  });
  const lists = [
    {
      edition: team("own", "Team"),
      chapters: [chapter("one"), chapter("part-two"), { ...chapter("volume-two"), volNum: 2 }],
    },
    {
      edition: team("repeat", "TEAM"),
      chapters: [
        chapter("duplicate"),
        chapter("extra-a", null),
        chapter("extra-b", null),
        chapter("next", 2),
      ],
    },
    { edition: team("other", "Other"), chapters: [chapter("other-one")] },
    {
      edition: { ...team("translation", "Team"), translatedLanguage: "fr" },
      chapters: [chapter("french")],
    },
  ];
  const merged = parseChapterLists(lists, manga, true);
  assert.equal(merged.length, 8);
  assert.ok(!merged.some((item) => item.chapterId === "/chapter/duplicate"));
  assert.ok(
    merged.some((item) => item.chapterId === "/chapter/other-one" && item.version === "Other"),
  );
  assert.ok(merged.some((item) => item.chapterId === "/chapter/french" && item.langCode === "fr"));
  assert.equal(merged.find((item) => item.chapterId === "/chapter/volume-two")?.volume, 2);
  assert.ok(merged.every((item) => item.sourceManga === manga));
  assert.equal(parseChapterLists(lists, manga, false).length, 9);
  const unknownTeams = ["unknown-one", "unknown-two"].map((id) => ({
    edition: { id, name: "A Work", translatedLanguage: "en" },
    chapters: [{ ...chapter(id), srcName: "mpark" }],
  }));
  assert.equal(parseChapterLists(unknownTeams, manga, true).length, 2);
});

void test("XCOMIC Merge editions fetches only allowed editions and retains separate team versions", async (t) => {
  const { requests } = mockApi(
    t,
    (query, variables) =>
      query.includes("work: title_titleNode")
        ? {
            get_comicNode: {
              data: {
                id: "own",
                name: "A Work [First]",
                translatedLanguage: "en",
                work: {
                  comicNodes: [
                    {
                      data: {
                        id: "second",
                        name: "A Work [Second]",
                        translatedLanguage: "en",
                        isPublic: true,
                      },
                    },
                    { data: { id: "foreign", name: "A Work", translatedLanguage: "fr" } },
                  ],
                },
              },
            },
          }
        : {
            chapterList: {
              paging: { pages: 1, total: 1 },
              items: [{ data: chapter(String(Reflect.get(variables.select ?? {}, "comic_id"))) }],
            },
          },
    { [STATE_KEYS.MERGE_EDITIONS]: true },
  );
  const chapters = await XCOMIC.getChapters(manga);
  assert.deepEqual(new Set(chapters.map((item) => item.version)), new Set(["First", "Second"]));
  assert.equal(requests.length, 3);
  assert.ok(
    requests.every(
      (request) => Reflect.get(request.variables.select ?? {}, "comic_id") !== "foreign",
    ),
  );
});
