/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test, { type TestContext } from "node:test";

import { ContentRating, type Request, type SourceManga } from "@paperback/types";

import { STATE_KEYS, type Preferences, type SwarmChapter } from "../../src/Swarm/models";
import { buildSearchUrl } from "../../src/Swarm/network";
import {
  encodeId,
  idOf,
  isAllowed,
  novelXHTML,
  parseChapterPages,
  parseChapters,
  parseComicPage,
  parseMangaDetails,
} from "../../src/Swarm/parsers";
import { encryptPayload } from "../../src/Swarm/utils";
registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/Swarm/forms/") && url.endsWith(".ts"))
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
const { Swarm } = await import("../../src/Swarm/main");
const { SwarmSettingsForm } = await import("../../src/Swarm/forms/settings");
Reflect.deleteProperty(globalThis, "Application");
const defaults: Preferences = {
  languages: ["en"],
  content: "all",
  chapterMode: "all",
  preferred: [],
  blocked: [],
};
const manga: SourceManga = {
  mangaId: "a-work",
  mangaInfo: {
    primaryTitle: "A Work",
    secondaryTitles: [],
    thumbnailUrl: "",
    synopsis: "",
    contentRating: ContentRating.EVERYONE,
  },
};
const chapter = (id: string, number: string, extra: Partial<SwarmChapter> = {}): SwarmChapter => ({
  id,
  number,
  lang: "en",
  source_name: "Team",
  rank: "a",
  published_date: "2026-11-04",
  ...extra,
});
const mock = (
  t: TestContext,
  reply: (url: globalThis.URL, request: Request) => unknown,
  state: Record<string, unknown> = {},
) => {
  const requests: Request[] = [],
    reads: string[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "Application");
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: {
      getState: (key: string) => {
        reads.push(key);
        return state[key];
      },
      setState: (value: unknown, key: string) => {
        state[key] = value;
      },
      decodeHTMLEntities: (text: string) => text,
      arrayBufferToUTF8String: (data: ArrayBuffer) => Buffer.from(data).toString(),
      invalidateDiscoverSections: () => undefined,
      scheduleRequest: async (request: Request) => {
        requests.push(request);
        return [
          { status: 200 },
          Uint8Array.from(
            Buffer.from(JSON.stringify(reply(new globalThis.URL(request.url), request))),
          ).buffer,
        ];
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "Application", original);
    else Reflect.deleteProperty(globalThis, "Application");
  });
  return { requests, reads, state };
};
void test("Swarm encrypted requests match an independent AES-CBC oracle", async () => {
  const iv = new Uint8Array(16).fill(9),
    payload = JSON.stringify({
      chapterId: "49cca67d9aebc",
      nocache: false,
      clean: false,
      force: false,
    });
  const key = createHash("sha256")
    .update("e3bca6f9a7e64e369ddc450bb7ff295b3d78e7d4fcb148c10d10ae9385476a5f")
    .digest();
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const expected = Buffer.concat([cipher.update(payload), cipher.final()]).toString("hex");
  assert.equal(await encryptPayload(payload, iv), `${Buffer.from(iv).toString("hex")}:${expected}`);
});
void test("Swarm parses complete flight objects, including braces and quotes in descriptions", () => {
  const input = {
    manga: {
      id: "86802",
      title: 'A "Title"',
      description: "a } brace and \\ slash",
      url: "a-work",
    },
    chapters: [chapter("one", "1")],
  };
  const flight = `4:["$","$L44",null,{"initialData":${JSON.stringify(input)}}]`;
  assert.deepEqual(parseComicPage(flight), input);
  const html = `<html><script>self.__next_f.push(${JSON.stringify([1, flight])})</script></html>`;
  assert.deepEqual(parseComicPage(html), input);
  assert.throws(() => parseComicPage('0:{"initialData":{"manga":'), /incomplete/);
});
void test("Swarm uses language settings, real upload ids, volume zero, groups and actual dates", () => {
  const entries = [
    chapter("en-a", "2"),
    chapter("en-b", "2", { rank: "b" }),
    chapter("es-a", "2", { lang: "es" }),
    chapter("one", "1", { published_date: "0001-01-01" }),
    chapter("other", "2", { source_name: "Other" }),
  ];
  const all = parseChapters(entries, manga, defaults);
  assert.equal(all.length, 4);
  assert.ok(all.every((value) => value.volume === 0 && value.langCode === "en"));
  assert.equal(all[0].chapterId, "en-a");
  assert.equal(all[0].publishDate?.toISOString(), "2026-11-04T00:00:00.000Z");
  assert.equal(all.find((value) => value.chapterId === "one")?.publishDate, undefined);
  assert.equal(parseChapters(entries, manga, { ...defaults, chapterMode: "group" }).length, 3);
  const preferred = parseChapters(entries, manga, {
    ...defaults,
    chapterMode: "chapter",
    preferred: ["other"],
  });
  assert.equal(preferred[0].chapterId, "other");
  assert.equal(parseChapters(entries, manga, { ...defaults, blocked: ["team"] }).length, 1);
});
void test("Swarm current site filters are encoded once and keep paging and content semantics", () => {
  const url = new globalThis.URL(
    buildSearchUrl(
      "",
      2,
      "title",
      {
        genres: [encodeId("Boys' Love")],
        types: ["Manhwa"],
        tags: [encodeId("Past Lives")],
        yearStartMin: "2020",
        minChapters: "100",
        content: ["safe"],
      },
      defaults,
    ),
  );
  assert.equal(url.pathname, "/api/manga/filtered");
  assert.equal(url.searchParams.get("genres"), "Boys' Love");
  assert.equal(url.searchParams.get("types"), "Manhwa,manhwa");
  assert.equal(url.searchParams.get("tags"), "Past Lives");
  assert.equal(url.searchParams.get("offset"), "50");
  assert.equal(url.searchParams.get("suggestive"), "false");
  assert.equal(url.searchParams.get("order"), "title");
  assert.throws(
    () => buildSearchUrl("", 1, "title", { minChapters: "nope" }, defaults),
    /whole numbers/,
  );
});
void test("Swarm Discover order, chips, real feeds and native settings reads stay bounded", async (t) => {
  const entries = [
    {
      id: "1",
      title: "Work",
      url: "a-work",
      cover: "https://swarm.ws/covers/a.jpg",
      readCount: 41,
      chapterCount: 12,
      lang: "en",
      chapter_id: "real-chapter",
      chapter: "12",
      released: "2026-11-04T12:00:00Z",
    },
  ];
  const { requests, reads } = mock(t, () => ({ data: entries, total: 1, hasMore: false }));
  const sections = await Swarm.getDiscoverSections();
  assert.deepEqual(
    sections.map((s) => s.title),
    [
      "Most Popular",
      "Most Followed New Comics",
      "Latest Updates (Hot)",
      "Random",
      "Latest Updates (New)",
      "Most Recent Popular",
      "Novels",
      "Genres",
    ],
  );
  const chips = await Swarm.getDiscoverSectionItems(sections[1], undefined);
  assert.deepEqual(
    chips.items.map((item) => (item.type === "genresCarouselItem" ? item.name : "")),
    ["7 days", "1 month", "3 months"],
  );
  assert.equal(requests.length, 0);
  const hero = await Swarm.getDiscoverSectionItems(sections[0], undefined);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /window=3m/);
  assert.equal(hero.items[0].type, "featuredCarouselItem");
  assert.ok("supertitle" in hero.items[0] && hero.items[0].supertitle === "#1");
  assert.equal(reads.filter((key) => key === STATE_KEYS.LANGUAGES).length, 1);
  const hot = await Swarm.getDiscoverSectionItems(sections[2], undefined);
  assert.ok("chapterId" in hot.items[0] && hot.items[0].chapterId === "real-chapter");
  assert.ok(
    "publishDate" in hot.items[0] &&
      hot.items[0].publishDate?.toISOString() === "2026-11-04T12:00:00.000Z",
  );
  const requestURL = new globalThis.URL(requests[1].url);
  assert.equal(requestURL.searchParams.get("filter"), "hot");
});
void test("Swarm filtered pages keep the server's continuation even when no cards survive", async (t) => {
  mock(t, () => ({
    data: [{ id: "foreign", title: "Foreign", url: "foreign", lang: "es" }],
    total: 51,
  }));
  const result = await Swarm.getSearchResults({ title: "" }, undefined);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.metadata, { page: 2 });
});
void test("Swarm language and rating settings affect feeds and persist without chapter-id changes", async (t) => {
  const { state } = mock(t, () => ({}));
  const form = new SwarmSettingsForm();
  await form.handleLanguages(["es"]);
  await form.handleContent(["safe"]);
  assert.deepEqual(state[STATE_KEYS.LANGUAGES], ["es"]);
  assert.equal(
    isAllowed({ id: "1", title: "Explicit", nsfw: true }, { ...defaults, content: "safe" }),
    false,
  );
  assert.equal(isAllowed({ id: "1", title: "Spanish", lang: "es" }, defaults), false);
  assert.equal(
    isAllowed({ id: "1", title: "Korean", lang: "kr" }, { ...defaults, languages: ["ko"] }),
    true,
  );
});
void test("Swarm novels keep paragraphs and emphasis in valid XHTML and use a separate catalog key", (t) => {
  mock(t, () => ({}));
  assert.equal(idOf({ id: 1, title: "Novel", slug: "a-novel" }), "novel%2Fa-novel");
  const source = parseMangaDetails({ id: 1, title: "Novel", slug: "a-novel" }, "novel%2Fa-novel");
  assert.equal(source.mangaInfo.contentType, "novel");
  const chapters = parseChapters([chapter("40707", "1072")], source, defaults);
  assert.equal(chapters[0].chapterId, "40707@1072");
  assert.equal(chapters[0].volume, 0);
  assert.equal(
    isAllowed(
      { id: "latin", title: "Spanish", lang: "es-la" },
      { ...defaults, languages: ["es-419"] },
    ),
    true,
  );
  const html = novelXHTML("First & second.\n\n<i>Dream on!</i>\nA line.");
  assert.match(html, /<p>First &amp; second\.<\/p>/);
  assert.match(html, /<i>Dream on!<\/i>/);
  assert.match(html, /<br\/>/);
  assert.ok(!html.includes("&nbsp;"));
});
void test("Swarm rejects its missing-upload placeholder instead of returning a broken image", () => {
  const item = {
    chapterId: "one",
    sourceManga: manga,
    chapNum: 1,
    volume: 0,
    langCode: "en",
    sortingIndex: 1,
  };
  assert.throws(
    () => parseChapterPages({ chapter: { data: ["https://cash.swarm.ws/noah/fall.png"] } }, item),
    /no readable images/,
  );
  assert.deepEqual(
    parseChapterPages({ chapter: { data: ["https://cash.swarm.ws/real.webp"] } }, item),
    { id: "one", mangaId: "a-work", pages: ["https://cash.swarm.ws/real.webp"] },
  );
});

void test("Swarm search and ordinary cards use two facts without rank or repeated metric labels", async (t) => {
  mock(t, () => ({}));
  const { toSearchItem } = await import("../../src/Swarm/parsers");
  assert.equal(
    toSearchItem({
      id: "1",
      title: "Work",
      latestChapterNumber: 0,
      chapterCount: 22,
      type: "Manhwa",
      views: 67300000,
    }).subtitle,
    "Ch. 0 | Manhwa",
  );
  assert.equal(
    toSearchItem({ id: 1, slug: "novel", title: "Novel", _count: { chapters: 23 } }).subtitle,
    "23 Chapters | Novel",
  );
});

void test("Swarm capitalizes specific types and omits unknown generic labels", async (t) => {
  mock(t, () => ({}));
  const { toSearchItem } = await import("../../src/Swarm/parsers");
  assert.equal(
    toSearchItem({ id: "jinx", title: "Jinx", type: "manhwa", chapterCount: 68 }).subtitle,
    "68 Chapters | Manhwa",
  );
  assert.equal(
    toSearchItem({ id: "villain", title: "Villain", type: "manhua", chapterCount: 788 }).subtitle,
    "788 Chapters | Manhua",
  );
  assert.equal(
    toSearchItem({
      id: "meta",
      title: "Meta",
      type: "Comic",
      demographic: "MANHUA",
      chapterCount: 143,
    }).subtitle,
    "143 Chapters | Manhua",
  );
  assert.equal(
    toSearchItem({
      id: "tag",
      title: "Tagged",
      type: "other",
      genres: ["Action", "Manhwa"],
      chapter_count: 0,
    }).subtitle,
    "0 Chapters | Manhwa",
  );
  assert.equal(toSearchItem({ id: "latest", title: "Latest", chapter: "472" }).subtitle, "Ch. 472");
  assert.equal(
    toSearchItem({ id: "latest", title: "Latest", type: "Comic", chapter: "472" }).subtitle,
    "Ch. 472",
  );
  assert.equal(
    toSearchItem({ id: "search", title: "Search", type: "manga", latest_chapter_number: 4 })
      .subtitle,
    "Ch. 4 | Manga",
  );
  assert.equal(
    toSearchItem({ id: "unknown", title: "Unknown", type: "Other" }).subtitle,
    undefined,
  );
});

void test("Swarm defaults to one per uploader and preserves explicitly saved choices", async (t) => {
  const { state } = mock(t, () => ({}));
  const { getPreferences } = await import("../../src/Swarm/forms/settings");
  assert.equal(getPreferences().chapterMode, "group");
  state[STATE_KEYS.CHAPTER_MODE] = "all";
  assert.equal(getPreferences().chapterMode, "all");
  const form = new SwarmSettingsForm();
  await form.handleMode([]);
  assert.equal(getPreferences().chapterMode, "group");
});

void test("Swarm uploader dedup picks site rank, then copy number, without losing other languages", () => {
  const entries = [
    chapter("unknown", "4", { source_name: "official", rank: undefined }),
    chapter("b", "4", { source_name: "official", rank: "b" }),
    chapter("a-copy3", "4", { source_name: "official3", rank: "a" }),
    chapter("a-copy2", "4", { source_name: "official2", rank: "a" }),
    chapter("a", "4", { source_name: "official", rank: "a" }),
    chapter("other", "4", { source_name: "mangadex", rank: "b" }),
    chapter("spanish", "4", { source_name: "official", rank: "a", lang: "es" }),
  ];
  const prefs = { ...defaults, chapterMode: "group", languages: ["en", "es"] };
  assert.deepEqual(
    parseChapters(entries, manga, prefs).map((c) => c.chapterId),
    ["a", "spanish", "other"],
  );
  assert.deepEqual(
    parseChapters(entries, manga, { ...prefs, blocked: ["official"] }).map((c) => c.chapterId),
    ["other"],
  );
  assert.equal(
    parseChapters(entries, manga, {
      ...defaults,
      chapterMode: "chapter",
      preferred: ["mangadex"],
    })[0].chapterId,
    "other",
  );
  assert.equal(parseChapters(entries, manga, { ...defaults, chapterMode: "all" }).length, 6);
});
