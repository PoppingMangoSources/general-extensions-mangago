/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test, { type TestContext } from "node:test";

import { ContentRating, type Request } from "@paperback/types";

import {
  parseChapters,
  parseNovelChapterDetails,
} from "../../src/Chikari/implementations/chapter-providing/parsers";
import { parseMangaDetails } from "../../src/Chikari/implementations/manga-details-providing/parsers";
import { DEFAULT_SEARCH_TYPES } from "../../src/Chikari/implementations/search-results-providing/models";
import {
  DOMAIN,
  STATE_KEYS,
  SAFE_ID_REGEX,
  type SeriesItem,
} from "../../src/Chikari/implementations/shared/models";
import { decodeMangaId, encodeMangaId } from "../../src/Chikari/implementations/shared/parsers";
import {
  fetchNovelChapters,
  fetchNovelChapterDetails,
  fetchNovelDetails,
} from "../../src/Chikari/services/network";

// SDK forms use parameter properties, which Node's default type stripping cannot load.
registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/Chikari/") && url.endsWith("/forms.ts"))
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
const { Chikari } = await import("../../src/Chikari/main");
Reflect.deleteProperty(globalThis, "Application");

const item = (medium: "comic" | "novel"): SeriesItem => ({
  slug: "shared-slug",
  title: medium === "novel" ? "A Novel" : "A Comic",
  type: medium === "novel" ? "novel" : "manga",
  medium,
  status: "releasing",
  is_nsfw: false,
  chapter_count: 2,
  cover_url: "https://images.test/cover.webp",
  latest_chapter: 2,
  last_chapter_at: "2026-11-03T00:00:00Z",
  rating: 9,
  views: 50,
});

const mockApi = (
  t: TestContext,
  reply: (url: globalThis.URL) => unknown,
  state: Record<string, unknown> = {},
) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Application");
  const requests: globalThis.URL[] = [];
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: {
      getState: (key: string) => state[key],
      setState: (value: unknown, key: string) => {
        state[key] = value;
      },
      arrayBufferToUTF8String: (buffer: ArrayBuffer) => Buffer.from(buffer).toString("utf8"),
      scheduleRequest: async (request: Request) => {
        const url = new globalThis.URL(request.url);
        requests.push(url);
        const data = reply(url);
        return [
          { status: data === undefined ? 404 : 200 },
          Uint8Array.from(Buffer.from(JSON.stringify(data ?? { detail: "Not Found" }))).buffer,
        ];
      },
    },
  });
  t.after(async () => {
    await Chikari.cloudflareBypassCompleted({ url: DOMAIN, method: "GET" }, [], {});
    if (original) Object.defineProperty(globalThis, "Application", original);
    else Reflect.deleteProperty(globalThis, "Application");
  });
  return requests;
};

void test("mixed search uses the unified list, one offset and stable medium-specific ids", async (t) => {
  const requests = mockApi(
    t,
    (url) =>
      url.pathname === "/api/series"
        ? { items: [item("comic"), item("novel")], total: 4 }
        : undefined,
    { [STATE_KEYS.EXCLUDED_GENRES]: ["hentai"], [STATE_KEYS.EXCLUDED_TAGS]: ["42"] },
  );
  const result = await Chikari.getSearchResults({ title: "shared" }, undefined);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].searchParams.getAll("type"), DEFAULT_SEARCH_TYPES);
  assert.equal(requests[0].searchParams.get("limit"), "24");
  assert.equal(requests[0].searchParams.get("content_rating"), "safe,suggestive");
  assert.deepEqual(requests[0].searchParams.getAll("genre_exclude"), ["hentai"]);
  assert.deepEqual(requests[0].searchParams.getAll("tag_exclude"), ["42"]);
  assert.deepEqual(
    result.items.map((entry) => entry.mangaId),
    ["shared-slug", "novel:shared-slug"],
  );
  assert.deepEqual(result.metadata, { offset: 2 });
  await Chikari.getSearchResults({ title: "shared" }, result.metadata);
  assert.equal(requests[1].searchParams.get("offset"), "2");
});

void test("novel chips preserve their type, ranking period and pagination on the shared endpoint", async (t) => {
  const requests = mockApi(t, (url) =>
    url.pathname === "/api/series" ? { items: [item("novel")], total: 1 } : undefined,
  );
  for (const period of ["day", "week", "month"] as const) {
    const result = await Chikari.getSearchResults(
      {
        title: "",
        metadata: {
          types: ["novel"],
          sort: "trending",
          period,
        },
      },
      undefined,
    );
    assert.equal(requests.at(-1)?.pathname, "/api/series");
    assert.deepEqual(requests.at(-1)?.searchParams.getAll("type"), ["novel"]);
    assert.equal(requests.at(-1)?.searchParams.get("sort"), `trending-${period}`);
    assert.equal(result.items[0].mangaId, "novel:shared-slug");
    assert.equal(result.metadata, undefined);
  }
});

void test("novel home rows use shared home filters and Discover keeps separate comic/novel controls", async (t) => {
  const requests = mockApi(
    t,
    (url) =>
      url.pathname === "/api/home"
        ? {
            rows: [{ slug: "recently-updated", items: [item("novel"), item("comic")] }],
          }
        : undefined,
    { [STATE_KEYS.EXCLUDED_GENRES]: ["hentai"] },
  );
  const sections = await Chikari.getDiscoverSections();
  const novelSection = sections.find((section) => section.id === "recently-updated-novels");
  assert.ok(novelSection);
  const result = await Chikari.getDiscoverSectionItems(novelSection, undefined);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, "/api/home");
  assert.deepEqual(requests[0].searchParams.getAll("type"), ["novel"]);
  assert.deepEqual(requests[0].searchParams.getAll("genre_exclude"), ["hentai"]);
  assert.equal(requests[0].searchParams.get("content_rating"), "safe,suggestive");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].type, "chapterUpdatesCarouselItem");
  assert.equal(result.items[0].mangaId, "novel:shared-slug");
  const recent = sections.find((section) => section.id === "recently-added");
  assert.ok(recent);
  const controls = await Chikari.getDiscoverSectionItems(recent, undefined);
  assert.deepEqual(
    controls.items.map((entry) => (entry.type === "genresCarouselItem" ? entry.name : "")),
    ["Comics", "Novels"],
  );
});

void test("genres and tags include novels through one shared request each", async (t) => {
  const requests = mockApi(t, (url) => {
    if (url.pathname === "/api/genres") return [{ slug: "fantasy", name: "Fantasy" }];
    if (url.pathname === "/api/tags") return [{ id: 12, name: "A tag", count: 8 }];
    return undefined;
  });
  assert.deepEqual(await Chikari.getGenreOptions(), [{ id: "fantasy", title: "Fantasy" }]);
  assert.deepEqual(await Chikari.getTagOptions(), [{ id: "12", title: "A tag" }]);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((url) => url.searchParams.get("novels") === "true"));
});

void test("novel details, paginated chapters and reading keep their separate routes", async (t) => {
  const requests = mockApi(t, (url) => {
    if (url.pathname.endsWith("/read"))
      return { body: "A paragraph.", locked: false, lock_reason: "" };
    if (url.pathname.endsWith("/chapters")) {
      const offset = Number(url.searchParams.get("offset"));
      return {
        items: Array.from({ length: offset ? 2 : 500 }, (_, i) => ({
          number: offset + i + 1,
          title: "",
          volume: "",
          lang: "en",
          created_at: "2026-11-03T00:00:00Z",
        })),
        total: 502,
      };
    }
    return {
      ...item("novel"),
      description: "A summary.",
      alt_titles: [],
      authors: [],
      genres: [],
      tags: [],
      year: null,
    };
  });
  const manga = parseMangaDetails(await fetchNovelDetails("shared-slug"), "novel");
  assert.equal(manga.mangaId, "novel:shared-slug");
  assert.equal(manga.mangaInfo.contentType, "novel");
  const response = await fetchNovelChapters("shared-slug");
  assert.equal(response.items.length, 502);
  assert.deepEqual(
    requests
      .filter((url) => url.pathname.endsWith("/chapters"))
      .map((url) => url.searchParams.get("offset")),
    ["0", "500"],
  );
  const chapters = parseChapters(response.items, manga);
  assert.equal(chapters[0].chapterId, "1");
  assert.equal(chapters.at(-1)?.chapNum, 502);
  const page = parseNovelChapterDetails(
    await fetchNovelChapterDetails("shared-slug", "1"),
    chapters[0],
  );
  assert.equal(page.type, "html");
  assert.ok(requests.every((url) => url.pathname.startsWith("/api/novels/shared-slug")));
});

void test("novel XHTML escapes text and refuses locked or empty chapters", () => {
  const manga = parseMangaDetails(
    {
      ...item("novel"),
      description: "",
      alt_titles: [],
      authors: [],
      genres: [],
      tags: [],
      year: null,
    },
    "novel",
  );
  const [chapter] = parseChapters(
    [{ number: 1, title: "", volume: "", lang: "en", created_at: "2026-11-03T00:00:00Z" }],
    manga,
  );
  const result = parseNovelChapterDetails(
    { body: "A & B < C\nline\n\nNext.", locked: false, lock_reason: "" },
    chapter,
  );
  assert.equal(result.type, "html");
  if (result.type !== "html") throw new Error("Expected novel XHTML");
  assert.equal(
    result.html,
    '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>A &amp; B &lt; C<br />line</p><p>Next.</p></body></html>',
  );
  assert.throws(
    () =>
      parseNovelChapterDetails(
        { body: "", locked: true, lock_reason: "Unlock on the website." },
        chapter,
      ),
    /Unlock on the website/,
  );
  assert.throws(
    () => parseNovelChapterDetails({ body: " ", locked: false, lock_reason: "" }, chapter),
    /No novel content/,
  );
  assert.deepEqual(decodeMangaId(encodeMangaId("shared-slug", "novel")), {
    medium: "novel",
    slug: "shared-slug",
  });
});

void test("scanlator versions keep default chapter ids and open only the requested scan", async (t) => {
  let fallback = false;
  const requests = mockApi(t, (url) => {
    if (url.pathname.endsWith("/chapters"))
      return {
        total: 3,
        items: [0, 1.5, null].map((number) => ({
          number,
          title: "A title",
          volume: "",
          lang: "en",
          created_at: "2026-07-04T06:52:42Z",
          scans:
            number === null
              ? []
              : [
                  { slug: "asura", name: "Asura", created_at: "2026-10-23T21:10:26Z" },
                  { slug: "official", name: "Official", created_at: "2026-10-29T04:53:27Z" },
                ],
        })),
      };
    if (url.pathname.endsWith("/chapters/1.5"))
      return {
        pages: [`https://images.test/${url.searchParams.get("scan") ?? "default"}.webp`],
        scan: fallback ? "asura" : url.searchParams.get("scan"),
        scan_fallback: fallback,
      };
    return undefined;
  });
  const manga = {
    mangaId: "omniscient-reader",
    mangaInfo: {
      primaryTitle: "Omniscient Reader",
      secondaryTitles: [],
      thumbnailUrl: "",
      synopsis: "",
      contentRating: ContentRating.EVERYONE,
    },
  };
  const chapters = await Chikari.getChapters(manga);
  assert.deepEqual(
    chapters.map((chapter) => chapter.chapterId),
    ["0", "0@asura", "0@official", "1.5", "1.5@asura", "1.5@official", "oneshot"],
  );
  assert.deepEqual(
    chapters.map((chapter) => chapter.version),
    ["Automatic", "Asura", "Official", "Automatic", "Asura", "Official", "Automatic"],
  );
  assert.deepEqual(
    chapters.map((chapter) => chapter.chapNum),
    [0, 0, 0, 1.5, 1.5, 1.5, 3],
  );
  assert.ok(chapters.every((chapter) => !chapter.chapterId.match(SAFE_ID_REGEX)));
  assert.equal(chapters[5].publishDate?.toISOString(), "2026-10-29T04:53:27.000Z");
  assert.equal(requests.length, 1);
  const official = await Chikari.getChapterDetails(chapters[5]);
  assert.ok("pages" in official);
  assert.deepEqual(official.pages, ["https://images.test/official.webp"]);
  assert.equal(official.id, "1.5@official");
  assert.equal(requests.at(-1)?.searchParams.get("scan"), "official");
  const automatic = await Chikari.getChapterDetails(chapters[3]);
  assert.ok("pages" in automatic);
  assert.deepEqual(automatic.pages, ["https://images.test/default.webp"]);
  assert.equal(requests.at(-1)?.searchParams.has("scan"), false);
  fallback = true;
  await assert.rejects(Chikari.getChapterDetails(chapters[5]), /scanlator.*unavailable/i);
});

void test("Random and Complete & Bingeable page with preferences and stable random seeds", async (t) => {
  let nextRandom = 0.1;
  t.mock.method(Math, "random", () => {
    nextRandom += 0.1;
    return nextRandom;
  });
  const requests = mockApi(
    t,
    (url) =>
      url.pathname === "/api/series"
        ? {
            items: [item("comic"), item("novel")],
            total: 4,
          }
        : undefined,
    {
      [STATE_KEYS.CONTENT_TYPES]: ["manga", "novel"],
      [STATE_KEYS.EXCLUDED_GENRES]: ["hentai"],
      [STATE_KEYS.EXCLUDED_TAGS]: ["42"],
      [STATE_KEYS.VISIBLE_SECTIONS]: ["featured"],
      [STATE_KEYS.SECTIONS_VERSION]: 2,
    },
  );
  const sections = await Chikari.getDiscoverSections();
  assert.deepEqual(
    sections.map((section) => section.id),
    ["featured", "random", "bingeable"],
  );
  const random = sections.find((section) => section.id === "random");
  const bingeable = sections.find((section) => section.id === "bingeable");
  assert.ok(random && bingeable);
  const first = await Chikari.getDiscoverSectionItems(random);
  assert.deepEqual(
    first.items.map((entry) => entry.type),
    ["simpleCarouselItem", "simpleCarouselItem"],
  );
  assert.ok(first.metadata && typeof first.metadata === "object" && !Array.isArray(first.metadata));
  assert.ok(first.metadata.seed);
  assert.equal(first.metadata.offset, 2);
  const second = await Chikari.getDiscoverSectionItems(random, first.metadata);
  assert.equal(second.metadata, undefined);
  assert.equal(requests[0].searchParams.get("seed"), requests[1].searchParams.get("seed"));
  assert.equal(requests[1].searchParams.get("offset"), "2");
  assert.deepEqual(
    first.items.map((entry) => ("mangaId" in entry ? entry.mangaId : "")),
    ["shared-slug", "novel:shared-slug"],
  );
  const complete = await Chikari.getDiscoverSectionItems(bingeable);
  assert.deepEqual(complete.metadata, { offset: 2 });
  assert.equal(requests.at(-1)?.searchParams.get("sort"), "bingeable");
  assert.equal(requests.at(-1)?.searchParams.has("seed"), false);
  assert.ok(requests.every((url) => url.searchParams.getAll("type").join() === "manga,novel"));
  assert.ok(requests.every((url) => url.searchParams.get("content_rating") === "safe,suggestive"));
  assert.ok(requests.every((url) => url.searchParams.get("genre_exclude") === "hentai"));
  assert.ok(requests.every((url) => url.searchParams.get("tag_exclude") === "42"));
  assert.equal(requests.length, 3);
  const refreshed = await Chikari.getDiscoverSectionItems(random);
  assert.notDeepEqual(refreshed.metadata, first.metadata);
  assert.equal(requests.at(-1)?.searchParams.get("offset"), "0");
  Application.setState(["featured"], STATE_KEYS.VISIBLE_SECTIONS);
  assert.deepEqual(
    (await Chikari.getDiscoverSections()).map((section) => section.id),
    ["featured"],
  );
});

void test("Random search sorting retains its seed and empty bingeable results stop paging", async (t) => {
  const requests = mockApi(t, (url) =>
    url.searchParams.get("sort") === "random"
      ? { items: [item("novel")], total: 2 }
      : { items: [], total: 0 },
  );
  const first = await Chikari.getSearchResults({ title: "" }, undefined, {
    id: "random",
    label: "Random",
  });
  assert.ok(first.metadata && typeof first.metadata === "object" && !Array.isArray(first.metadata));
  await Chikari.getSearchResults({ title: "" }, first.metadata, { id: "random", label: "Random" });
  assert.equal(requests[0].searchParams.get("seed"), requests[1].searchParams.get("seed"));
  const empty = await Chikari.getSearchResults(
    { title: "", metadata: { types: ["novel"], sort: "bingeable" } },
    undefined,
  );
  assert.deepEqual(empty, { items: [], metadata: undefined });
  assert.equal(requests.at(-1)?.searchParams.get("type"), "novel");
  assert.equal(requests.at(-1)?.searchParams.has("seed"), false);
});
