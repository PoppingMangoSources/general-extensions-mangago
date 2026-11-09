/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Request, type SourceManga } from "@paperback/types";
import { decodeHTML } from "entities";

import { NovelArchiveAdvancedSearchForm } from "../../src/NovelArchive/forms/search";
import { STATE_KEYS, type Novel } from "../../src/NovelArchive/models";
import { buildNovelsUrl } from "../../src/NovelArchive/network";
import {
  mergeChapterVersions,
  encodeId,
  decodeId,
  parseChapters,
  parseGenreOptions,
  parseMangaDetails,
  parseNovelList,
  parseSourceChapterDetails,
  parseSourceChapters,
  toSearchResultItem,
  filterNovelList,
  parseChapterDetails,
} from "../../src/NovelArchive/parsers";

const state: Record<string, unknown> = {};
Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: {
    getState: (key: string) => state[key],
    setState: (value: unknown, key: string) => {
      state[key] = value;
    },
    decodeHTMLEntities: decodeHTML,
    arrayBufferToUTF8String: (buffer: ArrayBuffer) => {
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        return undefined;
      }
    },
    Selector: (target: object, method: string) => ({ target, method }),
  },
});
const novel: Novel = {
  id: "abc",
  title: "Example",
  genres: "Fantasy",
  cover_url: "/cover.jpg",
  total_chapters: "226",
  rating: 4.5,
};
const manga: SourceManga = {
  mangaId: "abc",
  mangaInfo: {
    primaryTitle: "Example",
    secondaryTitles: [],
    thumbnailUrl: "https://novelarchive.cc/cover.jpg",
    synopsis: "",
    contentRating: ContentRating.EVERYONE,
  },
};

void test("genre-match control writes the metadata consumed by requests", async () => {
  const form = new NovelArchiveAdvancedSearchForm({ title: "" }, []);
  Reflect.set(form, "reloadForm", () => {});
  const row = form
    .getSections()
    .find((section) => section.id === "genre_match")
    ?.items.find((entry) => entry.id === "any");
  assert.ok(row && "onSelect" in row && row.onSelect);
  const selector = row.onSelect as unknown as { target: object; method: string };
  const callback = Reflect.get(selector.target, selector.method) as () => Promise<void>;
  await callback.call(selector.target);
  assert.deepEqual(form.getSearchQueryMetadata().genreMatch, ["any"]);
});

void test("details and filter options share normalized genre IDs", () => {
  const details = parseMangaDetails(novel, "abc");
  assert.equal(
    details.mangaInfo.tagGroups?.[0].tags[0].id,
    parseGenreOptions([{ value: "Fantasy", label: "Fantasy" }])[0].id,
  );
});

void test("mirror versions merge by chapter number without changing saved IDs", () => {
  const native = parseChapters(
    { ...novel, chapter_names: ["Chapter 1 - Start", "Chapter 2 - Next"] },
    manga,
  );
  const mirror = parseSourceChapters({ id: "mirror" }, [{ number: 100 }, { number: 101 }], manga);
  const result = mergeChapterVersions(native, mirror);
  assert.deepEqual(
    result.map((entry) => entry.chapNum),
    [1, 2, 100, 101],
  );
  assert.deepEqual(
    result.map((entry) => entry.chapterId),
    ["1", "2", "mirror:100", "mirror:101"],
  );
});

void test("listing totals are labeled as totals and invalid cards are omitted", () => {
  const items = parseNovelList([
    novel,
    { ...novel, title: " " },
    { ...novel, cover_url: "javascript:alert(1)" },
    { ...novel, cover_url: "" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(toSearchResultItem(items[0]).subtitle, "226 Chs • ★ 4.5");
});

void test("latest release labels distinguish chapter numbers from totals and elapsed time", () => {
  for (const [release, count, expected] of [
    ["Chapter 134 - 103: This Is Too Much Noise!", "3", "Ch. 134 • ★ 4.5"],
    ["Chapter 1225", "1223", "Ch. 1225 • ★ 4.5"],
    ["Vol 7 Chapter 38", "5950", "Ch. 38 • ★ 4.5"],
    ["Ch. #12.5", "20", "Ch. 12.5 • ★ 4.5"],
    ["Chapter 0 - Prologue", "1", "Ch. 0 • ★ 4.5"],
    ["9 hours ago", "1766", "1766 Chs • ★ 4.5"],
    ["Unknown", "226", "226 Chs • ★ 4.5"],
  ] as const) {
    const [item] = parseNovelList([{ ...novel, latest_release: release, total_chapters: count }]);
    assert.equal(toSearchResultItem(item).subtitle, expected);
  }
});

void test("explicit genre selections replace defaults including an empty reset", () => {
  state[STATE_KEYS.DEFAULT_GENRES] = { fantasy: "included", horror: "excluded" };
  const explicit = new globalThis.URL(
    buildNovelsUrl({ page: 1, genresInclude: ["action"], genresExclude: [] }),
  );
  assert.equal(explicit.searchParams.get("genres_include"), "action");
  assert.equal(explicit.searchParams.has("genres_exclude"), false);
  const reset = new globalThis.URL(
    buildNovelsUrl({ page: 1, genresInclude: [], genresExclude: [] }),
  );
  assert.equal(reset.searchParams.has("genres_include"), false);
  assert.equal(reset.searchParams.has("genres_exclude"), false);
  delete state[STATE_KEYS.DEFAULT_GENRES];
});

void test("empty mirror markup is rejected before reaching the reader", () => {
  assert.throws(
    () =>
      parseSourceChapterDetails(
        { content_html: "<p><br></p>" },
        { chapterId: "mirror:1", sourceManga: manga, chapNum: 1, langCode: "en" },
      ),
    /content/i,
  );
});

void test("native chapters use endpoint positions while preserving printed zero and decimals", () => {
  const chapters = parseChapters(
    { ...novel, chapter_names: ["Chapter 0 - Prologue", "Chapter 1.5 - Interlude"] },
    manga,
  );
  assert.deepEqual(
    chapters.map(({ chapterId, chapNum, title }) => [chapterId, chapNum, title]),
    [
      ["1", 0, "Prologue"],
      ["2", 1.5, "Interlude"],
    ],
  );
});

void test("illustrated mirror XHTML resolves site-relative images and keeps image-only chapters", () => {
  const chapter = { chapterId: "mirror:1", sourceManga: manga, chapNum: 1, langCode: "en" };
  const result = parseSourceChapterDetails(
    {
      content_html: '<img src="/api/novels/abc/sources/mirror/img/page.jpg"><p>Text &amp; more</p>',
    },
    chapter,
  );
  assert.equal(result.type, "html");
  if (result.type === "html")
    assert.match(result.html, /src="https:\/\/novelarchive\.st\/api\/novels\/abc/);
  assert.doesNotThrow(() =>
    parseSourceChapterDetails({ content_html: '<img src="/page.jpg">' }, chapter),
  );
});

void test("native reader rejects verified upstream security placeholders", () => {
  assert.throws(
    () =>
      parseChapterDetails(
        {
          chapter: {
            content:
              "Lord of the Mysteries\n\n#1438Concluding remarks (Part1)\nSecurity Check Required\nPlease complete the security check\nWe've detected unusual reading activity from your IP address.",
          },
        },
        { chapterId: "1438", sourceManga: manga, chapNum: 1438, langCode: "en" },
      ),
    /security check/i,
  );
});

void test("punctuation in live genre names survives safe-ID round trips", () => {
  for (const value of ["bl (boys' love)", "r*pe", "s*xual abuse", "slice of life"]) {
    assert.equal(decodeId(encodeId(value)), value);
    assert.doesNotMatch(encodeId(value), /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/);
  }
});

const { NovelArchive } = await import("../../src/NovelArchive/main");
const mockResponses = (reply: (url: globalThis.URL) => unknown) => {
  const requests: globalThis.URL[] = [];
  Reflect.set(Application, "scheduleRequest", async (request: Request) => {
    const url = new globalThis.URL(request.url);
    requests.push(url);
    const data = reply(url);
    return [{ status: 200 }, new TextEncoder().encode(JSON.stringify(data)).buffer];
  });
  return requests;
};

void test("genre memo retries failures and reuses a successful request without persistent taxonomy", async () => {
  let fail = true;
  const requests = mockResponses(() => {
    if (fail) {
      fail = false;
      throw new Error("temporary network failure");
    }
    return { genres: [{ value: "fantasy", label: "Fantasy" }] };
  });
  await assert.rejects(NovelArchive.getSettingsForm(), /temporary/);
  await Promise.all([
    NovelArchive.getSettingsForm(),
    NovelArchive.getAdvancedSearchForm({ title: "" }),
  ]);
  assert.equal(requests.length, 2);
  assert.equal(Object.hasOwn(state, "novelarchive_genres"), false);
  await NovelArchive.cloudflareBypassCompleted(
    { url: "https://novelarchive.st", method: "GET" },
    [],
    {},
  );
});

void test("Discover feeds request 50, library sections page by 30 and defaults apply once", async () => {
  state[STATE_KEYS.DEFAULT_GENRES] = { fantasy: "included", adult: "excluded" };
  const requests = mockResponses((url) => ({
    novels: [novel, { ...novel, genres: "Adult" }],
    ...(url.pathname === "/api/novels" ? { pagination: { has_next: true } } : {}),
  }));
  for (const section of (await NovelArchive.getDiscoverSections()).filter(
    (entry) => entry.id !== "genres",
  )) {
    const result = await NovelArchive.getDiscoverSectionItems(section, undefined);
    assert.equal(result.items.length, 1);
    if (section.id === "top-rated" || section.id === "recently-added") {
      assert.deepEqual(result.metadata, { page: 2 });
    } else {
      assert.equal(Object.hasOwn(result, "metadata"), false);
    }
  }
  assert.equal(requests.length, 5);
  assert.deepEqual(
    requests.map((url) => url.pathname),
    [
      "/api/novels/trending",
      "/api/novels",
      "/api/novels",
      "/api/novels/recently-updated",
      "/api/novels/editors-choice",
    ],
  );
  for (const url of requests) {
    if (url.pathname === "/api/novels") {
      assert.equal(url.searchParams.get("per_page"), "30");
    } else {
      assert.equal(url.searchParams.get("limit"), "50");
    }
  }
  assert.equal(requests[1].searchParams.get("sort"), "rating");
  assert.equal(requests[2].searchParams.has("sort"), false);
  delete state[STATE_KEYS.DEFAULT_GENRES];
});

void test("filtered empty pages retain the unfiltered has_next and final metadata is omitted", async () => {
  state[STATE_KEYS.HIDE_ADULT] = true;
  mockResponses(() => ({
    novels: [{ ...novel, genres: "Adult" }],
    pagination: { has_next: true },
  }));
  const filtered = await NovelArchive.getSearchResults({ title: "" }, undefined);
  assert.deepEqual(filtered, { items: [], metadata: { page: 2 } });
  mockResponses(() => ({ novels: [novel], pagination: { has_next: false } }));
  const last = await NovelArchive.getSearchResults({ title: "" }, undefined);
  assert.equal(Object.hasOwn(last, "metadata"), false);
  delete state[STATE_KEYS.HIDE_ADULT];
});

void test("both current and old pasted URLs resolve directly and request errors remain visible", async () => {
  const requests = mockResponses(() => ({ novel }));
  for (const domain of ["cc", "st"]) {
    const result = await NovelArchive.getSearchResults(
      { title: `https://novelarchive.${domain}/novel?id=abc` },
      undefined,
    );
    assert.equal(result.items[0].mangaId, "abc");
    assert.equal(requests.at(-1)?.pathname, "/api/novels/abc");
  }
  mockResponses(() => {
    throw new Error("upstream failure");
  });
  await assert.rejects(
    NovelArchive.getSearchResults({ title: "https://novelarchive.st/novel?id=abc" }, undefined),
    /upstream failure/,
  );
});

void test("defaults can be cleared in search and adult visibility applies to genre chips", async () => {
  state[STATE_KEYS.DEFAULT_GENRES] = { horror: "included" };
  const form = new NovelArchiveAdvancedSearchForm({ title: "" }, []);
  await form.handleGenresChange({});
  assert.deepEqual(form.getSearchQueryMetadata().genres, {});
  const requests = mockResponses(() => ({ novels: [novel], pagination: { has_next: false } }));
  const result = await NovelArchive.getSearchResults(
    { title: "", metadata: form.getSearchQueryMetadata() },
    undefined,
  );
  assert.equal(result.items.length, 1);
  assert.equal(requests[0].searchParams.has("genres_include"), false);
  state[STATE_KEYS.HIDE_ADULT] = true;
  mockResponses(() => ({
    genres: [
      { value: "adult", label: "Adult" },
      { value: "fantasy", label: "Fantasy" },
    ],
  }));
  const section = (await NovelArchive.getDiscoverSections()).find(
    (entry) => entry.id === "genres",
  )!;
  const chips = await NovelArchive.getDiscoverSectionItems(section, undefined);
  assert.equal(chips.items.length, 1);
  delete state[STATE_KEYS.DEFAULT_GENRES];
  delete state[STATE_KEYS.HIDE_ADULT];
  await NovelArchive.cloudflareBypassCompleted(
    { url: "https://novelarchive.st", method: "GET" },
    [],
    {},
  );
});

void test("native missing-name fallback and per-search genre OR preserve endpoint semantics", () => {
  const chapters = parseChapters({ ...novel, chapter_names: [], total_chapters: "2" }, manga);
  assert.deepEqual(
    chapters.map(({ chapterId, chapNum, title }) => [chapterId, chapNum, title]),
    [
      ["1", 1, undefined],
      ["2", 2, undefined],
    ],
  );
  const items = parseNovelList([novel, { ...novel, genres: "Action" }]);
  assert.equal(
    filterNovelList(items, { fantasy: "included", action: "included" }, false, "any").length,
    2,
  );
  assert.equal(
    filterNovelList(items, { fantasy: "included", action: "included" }, false, "all").length,
    0,
  );
  assert.equal(
    toSearchResultItem(parseNovelList([{ ...novel, chapter_names: ["Chapter 0 - Prologue"] }])[0])
      .subtitle,
    "Ch. 0 • ★ 4.5",
  );
});

void test("mirror mojibake repair preserves valid Unicode, markup and invalid Latin-1 runs", () => {
  const chapter = { chapterId: "mirror:1", sourceManga: manga, chapNum: 1, langCode: "en" };
  const result = parseSourceChapterDetails({ content_html: "<p>â café 中文</p>" }, chapter);
  if (result.type === "html") {
    assert.match(decodeHTML(result.html), /’ café 中文/);
    assert.match(result.html, /<p>/);
  }
});
