/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
import assert from "node:assert/strict";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test, { type TestContext } from "node:test";

import { ContentRating, type Request, type SourceManga } from "@paperback/types";
import * as cheerio from "cheerio";

import { STATE_KEYS, type Preferences, type MangaListItem } from "../../src/MGRead/models";
import { applyContentFilters, buildBrowseUrl, fetchReaderPage } from "../../src/MGRead/network";
import {
  encodeId,
  parseMangaList,
  parseChapters,
  parseChapterPages,
  parseSearchItems,
} from "../../src/MGRead/parsers";
import { decryptReader } from "../../src/MGRead/utils";
registerHooks({
  load(url, context, nextLoad) {
    if (url.includes("/src/MGRead/forms/") && url.endsWith(".ts"))
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
const { MGRead } = await import("../../src/MGRead/main");
const { MGReadSettingsForm } = await import("../../src/MGRead/forms/settings");
const { MGReadAdvancedSearchForm } = await import("../../src/MGRead/forms/search");
Reflect.deleteProperty(globalThis, "Application");
const defaults: Preferences = {
  ratings: Object.values(ContentRating),
  excludedGenres: [],
  hideLocked: false,
};
const sourceManga: SourceManga = {
  mangaId: "a-work",
  mangaInfo: {
    primaryTitle: "A Work",
    secondaryTitles: [],
    thumbnailUrl: "",
    synopsis: "",
    contentRating: ContentRating.EVERYONE,
  },
};
const card = (slug = "a-work") =>
  `<div class="manga-item-grid"><h3><a href="https://mgread.io/manga/${slug}/">A Work</a></h3><img data-src="https://mgread.io/cover.webp" src="data:image/png;base64,AA"><div class="manga-stats-bar"><span><i uk-icon="star"></i>4.8</span><span><i uk-icon="eye"></i>17.2 K</span><span><i uk-icon="bookmark"></i>200</span></div><a href="https://mgread.io/manga/${slug}/chapter-12/"><span class="badge-new" uk-tooltip="1 hour"></span>Chapter 12</a></div>`;
const mock = (
  t: TestContext,
  reply: (url: globalThis.URL, request: Request) => unknown,
  state: Record<string, unknown> = {},
) => {
  const requests: Request[] = [];
  const original = Object.getOwnPropertyDescriptor(globalThis, "Application");
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: {
      getState: (key: string) => state[key],
      setState: (value: unknown, key: string) => {
        state[key] = value;
      },
      decodeHTMLEntities: (value: string) => cheerio.load(value).text(),
      arrayBufferToUTF8String: (value: ArrayBuffer) => Buffer.from(value).toString(),
      base64Decode: (value: string) => Uint8Array.from(Buffer.from(value, "base64")).buffer,
      invalidateDiscoverSections: () => undefined,
      scheduleRequest: async (request: Request) => {
        requests.push(request);
        const value = reply(new globalThis.URL(request.url), request);
        return [
          { status: 200 },
          Uint8Array.from(Buffer.from(typeof value === "string" ? value : JSON.stringify(value)))
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
void test("MGRead uses real ranking metadata, lazy covers, chapter keys and update dates", (t) => {
  mock(t, () => ({}));
  const items = parseMangaList(cheerio.load(card() + `<aside>${card("sidebar")}</aside>`));
  assert.equal(items.length, 1);
  assert.equal(items[0].rating, 4.8);
  assert.equal(items[0].views, "17.2 K");
  assert.equal(items[0].follows, "200");
  assert.equal(items[0].latest?.number, 12);
  assert.equal(decodeURIComponent(items[0].latest!.id), "a-work/chapter-12");
  assert.ok(Math.abs(items[0].latest!.date!.getTime() - (Date.now() - 3600000)) < 1000);
  assert.equal(items[0].cover, "https://mgread.io/cover.webp");
  assert.equal(decodeURIComponent(encodeId("Boys' Love")), "Boys' Love");
  assert.equal(
    parseSearchItems([
      { post_type: "manga", title: "<mark>A</mark> Work", url: "https://mgread.io/manga/a-work/" },
    ])[0].title,
    "A Work",
  );
});
void test("MGRead preserves site pagination and repeated genre filters", () => {
  const url = new globalThis.URL(
    buildBrowseUrl(2, "rating", {
      genres: ["cooking", "romance"],
      age: ["18+"],
      status: ["completed"],
      types: ["novel"],
      ratingMin: ["3"],
    }),
  );
  assert.equal(url.pathname, "/advanced-filter/page/2/");
  assert.deepEqual(url.searchParams.getAll("genre[]"), ["cooking", "romance"]);
  assert.equal(url.searchParams.get("age_rating"), "18+");
  assert.equal(url.searchParams.get("sort"), "rating");
  assert.equal(url.searchParams.get("type"), "novel");
});
void test("MGRead global exclusions use one bulk lookup, preserve ordering and fail closed", async (t) => {
  const { requests } = mock(t, () => [
    { slug: "b", class_list: ["genre-action", "genre-smut"] },
    { slug: "a", class_list: ["genre-romance"] },
  ]);
  const items: MangaListItem[] = ["b", "missing", "a"].map((id) => ({
    id,
    title: id,
    cover: "",
    genres: [],
    contentRating: ContentRating.EVERYONE,
  }));
  assert.deepEqual(await applyContentFilters(items, defaults), items);
  assert.equal(requests.length, 0);
  const filtered = await applyContentFilters(items, { ...defaults, excludedGenres: ["smut"] });
  assert.deepEqual(
    filtered.map((x) => x.id),
    ["a"],
  );
  assert.equal(requests.length, 1);
  assert.equal(new globalThis.URL(requests[0].url).searchParams.get("slug"), "b,missing,a");
  const adult = await applyContentFilters(items, { ...defaults, ratings: [ContentRating.ADULT] });
  assert.deepEqual(
    adult.map((x) => x.id),
    ["b"],
  );
  assert.equal(adult[0].contentRating, ContentRating.ADULT);
});
void test("MGRead Discover uses requested section types and exact Top Manga range endpoint", async (t) => {
  const { requests } = mock(t, (url) =>
    url.pathname.includes("top-ranking") ? { posts: [{ html: card() }] } : card(),
  );
  const sections = await MGRead.getDiscoverSections();
  assert.deepEqual(
    sections.map((x) => x.title),
    ["Most Popular", "Top Rated", "Top Manga", "Latest Updates", "Top Follows", "Power Ranking"],
  );
  const chips = await MGRead.getDiscoverSectionItems(sections[2], undefined);
  assert.equal(requests.length, 0);
  assert.deepEqual(
    chips.items.map((x) => (x.type === "genresCarouselItem" ? x.name : "")),
    ["Day", "Week", "Month"],
  );
  const result = await MGRead.getSearchResults(
    { title: "", metadata: { topWindow: "week" } },
    undefined,
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.metadata, undefined);
  assert.equal(new globalThis.URL(requests[0].url).pathname, "/wp-json/initmanga/v1/top-ranking");
  assert.match(requests[0].url, /range=week/);
  assert.equal(
    (await MGRead.getDiscoverSectionItems(sections[0], undefined)).items[0].type,
    "featuredCarouselItem",
  );
  assert.equal(
    (await MGRead.getDiscoverSectionItems(sections[1], undefined)).items[0].type,
    "prominentCarouselItem",
  );
  assert.equal(
    (await MGRead.getDiscoverSectionItems(sections[3], undefined)).items[0].type,
    "chapterUpdatesCarouselItem",
  );
});
void test("MGRead Latest exclusions preserve a continuation even if the page becomes empty", async (t) => {
  const { requests } = mock(
    t,
    (url) =>
      url.pathname.includes("wp/v2")
        ? [{ slug: "a-work", class_list: ["genre-hentai"] }]
        : card() +
          `<ul class="uk-pagination"><li><a href="/page/2/"><span uk-pagination-next></span></a></li></ul>`,
    { [STATE_KEYS.GENRES]: ["hentai"] },
  );
  const sections = await MGRead.getDiscoverSections(),
    result = await MGRead.getDiscoverSectionItems(sections[3], undefined);
  assert.deepEqual(result.items, []);
  assert.deepEqual(result.metadata, { page: 2 });
  assert.equal(requests.length, 2);
});
void test("MGRead chapters use zero volumes, timezone-correct dates and readable lock labels", (t) => {
  mock(t, () => ({}));
  const result = parseChapters(
    [
      {
        id: 1,
        slug: "chapter-12",
        number: 12,
        title: "Chapter 12: Hello",
        created_at: "2026-04-02 11:12:59",
        lock_type: "paid",
        is_purchased: false,
      },
    ],
    sourceManga,
  );
  assert.equal(result[0].volume, 0);
  assert.equal(result[0].publishDate?.toISOString(), "2026-04-02T04:12:59.000Z");
  assert.equal(result[0].title, "Locked · Hello");
});
void test("MGRead keeps lazy image order and produces XHTML with emphasis and escaped entities", (t) => {
  mock(t, () => ({}));
  const chapter = {
    chapterId: "a-work%2Fchapter-12",
    sourceManga,
    chapNum: 12,
    volume: 0,
    langCode: "en",
    sortingIndex: 1,
  };
  const images = parseChapterPages(
    cheerio.load(
      '<div id="chapter-content"><img data-original-src="https://mgread.io/1.jpg" src="data:image/png;base64,AA"><img src="https://mgread.io/2.jpg"></div>',
    ),
    chapter,
  );
  assert.ok("pages" in images);
  if ("pages" in images)
    assert.deepEqual(images.pages, ["https://mgread.io/1.jpg", "https://mgread.io/2.jpg"]);
  const result = parseChapterPages(
    cheerio.load(
      '<div id="chapter-content"><p><b>Bold</b> &amp; <i>italic</i><br>text&nbsp;</p></div>',
    ),
    chapter,
  );
  assert.ok("html" in result);
  if ("html" in result) {
    assert.match(result.html, /<b>Bold<\/b>/);
    assert.match(result.html, /<i>italic<\/i><br\/>/);
    assert.ok(!result.html.includes("&nbsp;"));
  }
  assert.throws(
    () => parseChapterPages(cheerio.load('<div class="lock-card"></div>'), chapter),
    /locked/,
  );
});
void test("MGRead browser-verification responses stop before requesting a reader key", async (t) => {
  const { requests } = mock(
    t,
    () =>
      '<script>var InitMangaEncryptedChapter={"mode":"gated","iv":"00","ciphertext":"AA=="};var InitMangaData={"headlessGuardEnabled":true};</script>',
  );
  await assert.rejects(fetchReaderPage("a-work%2Fchapter-12"), /browser verification/);
  assert.equal(requests.length, 1);
});
void test("MGRead forms persist exclusions and omit unset advanced metadata", async (t) => {
  const { state } = mock(t, () => ({}));
  const settings = new MGReadSettingsForm([]);
  await settings.handleGenres(["hentai"]);
  await settings.handleRatings([ContentRating.EVERYONE]);
  assert.deepEqual(state[STATE_KEYS.GENRES], ["hentai"]);
  const form = new MGReadAdvancedSearchForm({ title: "" }, []);
  assert.deepEqual(form.getSearchQueryMetadata(), {});
});

void test("MGRead protected reader decrypts current grants and legacy salted chapters", async (t) => {
  mock(t, () => ({}));
  const password = "reader-password",
    salt = Buffer.alloc(16, 7),
    iv = Buffer.alloc(16, 9),
    rawKey = Buffer.alloc(32, 5),
    html = "<p><b>Readable</b> chapter.</p>";
  for (const legacy of [false, true]) {
    const key = legacy ? pbkdf2Sync(password, salt, 999, 32, "sha512") : rawKey;
    const cipher = createCipheriv("aes-256-cbc", key, iv),
      ciphertext = Buffer.concat([cipher.update(html), cipher.final()]).toString("base64");
    const result = await decryptReader(
      {
        encrypted: { iv: iv.toString("hex"), ciphertext, salt: salt.toString("hex") },
        config: { decryption_key: Buffer.from(password).toString("base64") },
      },
      legacy ? undefined : rawKey.toString("hex"),
    );
    assert.equal(result, html);
  }
});

void test("MGRead subtitles keep the chapter before rating and hero metrics have no extra words", async (t) => {
  mock(t, () => card());
  const { listingSubtitle } = await import("../../src/MGRead/parsers");
  const item = parseMangaList(cheerio.load(card()))[0];
  assert.equal(listingSubtitle(item), "Ch. 12 • ★ 4.8");
  const sections = await MGRead.getDiscoverSections(),
    row = await MGRead.getDiscoverSectionItems(sections[0], undefined),
    hero = row.items[0];
  assert.ok("infoItems" in hero);
  if ("infoItems" in hero)
    assert.deepEqual(hero.infoItems, [
      { symbol: "eye.fill", text: "17.2K" },
      { symbol: "star.fill", text: "4.8" },
    ]);
  const results = await MGRead.getSearchResults({ title: "" }, undefined);
  assert.equal(results.items[0].subtitle, "Ch. 12 • ★ 4.8");
});
