/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test, { type TestContext } from "node:test";

import {
  ContentRating,
  DiscoverSectionType,
  type Request,
  type SourceManga,
} from "@paperback/types";

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
const { getMergeEditions, getDeduplicateChapters, getEditionFilters, XComicSettingsForm } =
  await import("../../src/XCOMIC/forms/settings");
const {
  parseChapterLists,
  toMergedEditions,
  filterEditions,
  toDiscoverItems,
  toTitleSources,
  toSourceManga,
  toRankedDiscoverItems,
} = await import("../../src/XCOMIC/parsers");
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
  const stateReads: string[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "Application");
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: {
      getState: (key: string) => {
        stateReads.push(key);
        return state[key];
      },
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
  return { requests, state, stateReads };
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
    {
      [STATE_KEYS.DEDUPLICATE_CHAPTERS]: false,
      [STATE_KEYS.INCLUDED_EDITIONS]: "non-matching team",
    },
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

void test("XCOMIC formats a Discover page with constant settings reads and keeps all cards", (t) => {
  const { stateReads, state } = mockApi(t, () => ({}));
  const nodes = Array.from({ length: 48 }, (_, index) => ({
    data: {
      id: String(index),
      name: "A Work [Team]",
      subName: "Team",
      urlCover: "https://images.test/cover.jpg",
      type: "manhwa",
    },
  }));
  const cards = toDiscoverItems(nodes, "simpleCarouselItem");
  assert.equal(cards.length, 48);
  assert.equal(stateReads.length, 2);
  assert.ok(cards.every((card) => "title" in card && card.title === "A Work [Team]"));
  for (const metric of ["top", "follows", "reviews", "comments", "chapters"] as const) {
    stateReads.length = 0;
    assert.equal(toRankedDiscoverItems(nodes, metric).length, 48);
    assert.equal(stateReads.length, 2);
  }
  state[STATE_KEYS.MERGE_EDITIONS] = true;
  stateReads.length = 0;
  const merged = toDiscoverItems(nodes, "prominentCarouselItem");
  assert.ok(merged.every((card) => "title" in card && card.title === "A Work"));
  assert.equal(stateReads.length, 2);
});

void test("XCOMIC Discover does not request chapter lists, sibling editions or team filters", async (t) => {
  const { requests, stateReads } = mockApi(
    t,
    (query) =>
      query.includes("get_title_browse_pager")
        ? { get_title_browse_pager: { next: null } }
        : {
            get_title_browse_items: [
              {
                data: {
                  id: "work",
                  name: "A Work",
                  type: "manhwa",
                  contentRating: "safe",
                  urlCover: "https://images.test/cover.jpg",
                },
                comicNodes: [
                  {
                    data: {
                      id: "own",
                      name: "A Work [Team]",
                      translatedLanguage: "en",
                      chaps_normal: 1,
                    },
                  },
                ],
              },
            ],
          },
    { [STATE_KEYS.MERGE_EDITIONS]: true, [STATE_KEYS.INCLUDED_EDITIONS]: "non-matching team" },
  );
  const result = await XCOMIC.getDiscoverSectionItems(
    { id: "top-rated", title: "Top Rated", type: DiscoverSectionType.featured },
    undefined,
  );
  assert.equal(result.items.length, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((request) => !/chapterList|title_titleNode/.test(request.query)));
  assert.ok(!stateReads.includes(STATE_KEYS.INCLUDED_EDITIONS));
  assert.ok(!stateReads.includes(STATE_KEYS.EXCLUDED_EDITIONS));
});

void test("XCOMIC team filters match exact labels or edition IDs and Exclude wins", (t) => {
  mockApi(t, () => ({}), {
    [STATE_KEYS.INCLUDED_EDITIONS]: " Asura Scans, OFFICIAL\nasura scans, custom ",
    [STATE_KEYS.EXCLUDED_EDITIONS]: " official ",
  });
  const filters = getEditionFilters();
  assert.deepEqual(filters, {
    included: ["asura scans", "official", "custom"],
    excluded: ["official"],
  });
  const editions = [
    { id: "asura", name: "A Work [Asura Scans]" },
    { id: "official", name: "A Work", subName: "Official" },
    { id: "unofficial", name: "A Work", subName: "Unofficial" },
    { id: "custom", name: "An unnamed edition" },
  ];
  assert.deepEqual(
    filterEditions(editions, filters).map((edition) => edition.id),
    ["asura", "custom"],
  );
  assert.equal(filterEditions(editions, { included: [], excluded: [] }).length, 4);
});

void test("XCOMIC team settings persist without invalidating or requesting Discover", async (t) => {
  const { requests, state } = mockApi(t, () => ({}));
  const form = await XCOMIC.getSettingsForm();
  assert.ok(form instanceof XComicSettingsForm);
  await form.handleIncludedEditionsChange("Asura Scans");
  await form.handleExcludedEditionsChange("Official");
  assert.equal(state[STATE_KEYS.INCLUDED_EDITIONS], "Asura Scans");
  assert.equal(state[STATE_KEYS.EXCLUDED_EDITIONS], "Official");
  assert.equal(requests.length, 0);
});

void test("XCOMIC filters editions before fetching their chapter lists and rejects an empty match", async (t) => {
  const { requests, state } = mockApi(
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
                    { data: { id: "second", name: "A Work [Second]", translatedLanguage: "en" } },
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
    { [STATE_KEYS.MERGE_EDITIONS]: true, [STATE_KEYS.INCLUDED_EDITIONS]: " second " },
  );
  const chapters = await XCOMIC.getChapters(manga);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0].version, "Second");
  assert.equal(chapters[0].sourceManga, manga);
  assert.equal(requests.length, 2);
  assert.equal(Reflect.get(requests[1].variables.select ?? {}, "comic_id"), "second");
  state[STATE_KEYS.EXCLUDED_EDITIONS] = "second";
  const previous = requests.length;
  await assert.rejects(XCOMIC.getChapters(manga), /No editions match/);
  assert.equal(requests.length - previous, 1);
});

void test("XCOMIC duplicate team labels never put edition IDs in titles", (t) => {
  mockApi(t, () => ({}));
  const sources = toTitleSources(
    {
      data: { id: "work", name: "A Home Far Away", urlCover: "https://images.test/cover.jpg" },
      comicNodes: ["m7jbkw", "second"].map((id) => ({
        data: {
          id,
          name: "A Home Far Away",
          subName: "scan beans",
          translatedLanguage: "en",
        },
      })),
    },
    ["en"],
  );
  const items = toDiscoverItems(sources, "simpleCarouselItem");
  assert.deepEqual(
    items.map((item) => ("title" in item ? item.title : undefined)),
    ["A Home Far Away [scan beans]", "A Home Far Away [scan beans]"],
  );
  assert.deepEqual(
    items.map((item) => ("mangaId" in item ? item.mangaId : undefined)),
    ["m7jbkw", "second"],
  );
  const details = toSourceManga({
    data: {
      id: "m7jbkw",
      name: "A Home Far Away",
      tags: ["n5pwg"],
      tagNodes: [{ data: { name: "European Ambience" } }],
    },
  });
  assert.deepEqual(
    details.mangaInfo.tagGroups?.flatMap((group) => group.tags.map((tag) => tag.title)),
    ["European Ambience"],
  );
});

void test("XCOMIC Latest excludes work genres and formats missing from an edition without detail requests", async (t) => {
  const { requests } = mockApi(
    t,
    () => ({
      get_title_latestUploads: {
        items: [
          { id: "blocked-genre", genre_ids: ["hentai"], format_ids: [] },
          { id: "blocked-format", genre_ids: [], format_ids: ["full_color"] },
          { id: "allowed", genre_ids: [], format_ids: [] },
        ].map(({ id, genre_ids, format_ids }) => ({
          chapters: [
            {
              data: {
                ...chapter(id),
                datePublic: 1700000000,
                comicNode: {
                  data: {
                    id,
                    name: id,
                    type: "manga",
                    contentRating: "safe",
                    translatedLanguage: "en",
                    urlCover: "https://images.test/cover.jpg",
                    genres: ["comedy"],
                    work: { data: { genre_ids, format_ids } },
                  },
                },
              },
            },
          ],
        })),
      },
    }),
    {
      [STATE_KEYS.EXCLUDED_GENRES]: ["hentai"],
      [STATE_KEYS.EXCLUDED_FORMATS]: ["full_color"],
    },
  );
  const result = await XCOMIC.getDiscoverSectionItems(
    {
      id: "latest-uploads",
      title: "Latest Uploads",
      type: DiscoverSectionType.chapterUpdates,
    },
    undefined,
  );
  assert.deepEqual(
    result.items.map((item) => ("mangaId" in item ? item.mangaId : undefined)),
    ["allowed"],
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].query, /work: title_titleNode.*genre_ids format_ids/s);
});
