/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

import type { SourceManga } from "@paperback/types";
import * as cheerio from "cheerio";

import {
  parseHomeCards,
  parseBrowseCards,
  toLatestItem,
  toSearchResult,
} from "../../src/YaoiMe/parsers";
registerHooks({
  load(url, context, nextLoad) {
    if (/\/src\/YaoiMe\/(forms|network)\.ts$/.test(url))
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
const { YaoiMeAdvancedSearchForm, getPreferences } = await import("../../src/YaoiMe/forms");
void test("coverless Latest cards keep a verified image fallback rather than breaking the whole row", (t) => {
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: { decodeHTMLEntities: (v: string) => v, getState: () => undefined },
  });
  t.after(() => Reflect.deleteProperty(globalThis, "Application"));
  const rows = Array.from(
    { length: 31 },
    (_, i) =>
      `<div class="relative flex"><a class="tile" href="/series/${i + 1}/work-${i}">${i === 28 ? "<span>Text cover placeholder</span>" : `<img src="/i/c/cover${i}?w=200">`}</a><div class="min-w-0"><a class="card-title" href="/series/${i + 1}/work-${i}">Work ${i}</a><div class="card-trail"><span>Manga</span></div><img src="/flags/GB.svg"><a href="/chapter/10/${i + 1}">Ch.0</a><time datetime="2026-11-04T13:00:00Z"></time></div></div>`,
  ).join("");
  const $ = cheerio.load(
    `<div class="section-head"><h2>Latest releases</h2></div><div>${rows}</div>`,
  );
  const cards = parseHomeCards($, "Latest releases");
  assert.equal(cards.length, 31);
  const items = cards.map(toLatestItem);
  assert.ok(items.every((item) => item && /^https?:\/\//.test(item.imageUrl)));
  assert.equal(items[28]?.imageUrl, "https://yaoi.me/apple-icon.png");
  assert.equal(items[28]?.subtitle, "Ch. 0 • Manga");
  assert.equal(items[0]?.imageUrl, "https://yaoi.me/i/c/cover0?w=720");
  assert.equal(toSearchResult(parseBrowseCards($)[28]).imageUrl, "https://yaoi.me/apple-icon.png");
  const metadata = new YaoiMeAdvancedSearchForm({ title: "" }, getPreferences(), {
    genres: [],
    tags: [],
    languages: [],
    types: [],
    statuses: [],
    ratings: [],
    demographics: [],
  }).getSearchQueryMetadata();
  assert.ok(Object.values(metadata).every((v) => v !== undefined));
});

const flight = (data: unknown): string =>
  `<script>self.__next_f.push([1,${JSON.stringify(JSON.stringify(data))}])</script>`;

void test("YaoiMe live contract regressions", async (t) => {
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: { decodeHTMLEntities: (v: string) => v, getState: () => undefined },
  });
  t.after(() => Reflect.deleteProperty(globalThis, "Application"));
  const { parseChapters, parseMangaId, parseMangaDetails, parseSearchFilters } =
    await import("../../src/YaoiMe/parsers");
  await t.test("clearing a saved default stays cleared", async () => {
    const form = new YaoiMeAdvancedSearchForm({ title: "" }, getPreferences(), {
      genres: [],
      tags: [],
      languages: [],
      types: [],
      statuses: [],
      ratings: [],
      demographics: [],
    });
    await form.handleLanguagesChange([]);
    await form.handleTypesChange([]);
    await form.handleRatingsChange([]);
    const metadata = form.getSearchQueryMetadata();
    assert.deepEqual(metadata.languages, []);
    assert.deepEqual(metadata.types, []);
    assert.deepEqual(metadata.ratings, []);
    assert.ok(Object.values(metadata).every((v) => v !== undefined));
  });
  await t.test("series links accept trailing slashes and numeric paths", () => {
    assert.equal(parseMangaId("https://yaoi.me/series/80778/name/?x=1"), "/series/80778/name");
    assert.equal(parseMangaId("https://yaoi.me/series/80778/"), "/series/80778");
  });
  await t.test("alternative titles include the structured list", () => {
    const $ = cheerio.load(
      `<h1>Passion</h1><div>패션</div><script type="application/ld+json">${JSON.stringify([{ alternateName: ["패션", "PASSION", "Pasión", "Страстное влечение"] }, { "@type": "BreadcrumbList" }])}</script>`,
    );
    assert.deepEqual(parseMangaDetails($, "/series/5102/bl-passion").mangaInfo.secondaryTitles, [
      "패션",
      "PASSION",
      "Pasión",
      "Страстное влечение",
    ]);
  });
  await t.test("all filter facets preserve site values and tag ids", () => {
    const options = parseSearchFilters(
      cheerio.load(
        flight({
          genres: [{ name: "Boys Love" }],
          tags: [{ name: "Full Color" }],
          types: [{ value: "doujinshi" }],
          statuses: [{ value: "releasing" }],
          content: [{ value: "safe" }],
          demographics: [{ value: "Shoujo" }],
          languages: [{ code: "en" }],
        }),
      ),
    );
    assert.deepEqual(options.tags, [{ id: "Full%20Color", title: "Full Color" }]);
    assert.equal(options.types[0].id, "doujinshi");
    assert.equal(options.statuses[0].id, "releasing");
    assert.equal(options.demographics[0].id, "Shoujo");
    assert.equal(options.languages[0].title, "English");
  });
  await t.test("specials keep their labels and ordering, volumes and zero survive", () => {
    const groups = [
      {
        label: "Notice.10",
        num: 3,
        numReal: 0,
        extra: true,
        after: 136,
        variants: [{ s: 47598, id: 5237906, lang: "en" }],
      },
      {
        label: "Ch.136",
        num: 136,
        numReal: 1,
        vol: 2,
        variants: [
          { s: 1, id: 10, lang: "en" },
          { s: 2, id: 11, lang: "en" },
          { s: 3, id: 12, lang: "es" },
        ],
      },
      { label: "Ch.0", num: 0, numReal: 1, variants: [{ s: 1, id: 13, lang: "en" }] },
      { label: "Special.", num: null, numReal: 0, variants: [{ s: 1, id: 14, lang: "en" }] },
    ];
    const $ = cheerio.load(flight({ groups, sources: { 1: "first", 2: "second" } }));
    const manga = { mangaId: "/series/5102/bl-passion" } as SourceManga;
    const all = parseChapters($, manga, ["en", "es"]);
    assert.equal(all.length, 6);
    const notice = all.find((c) => c.chapterId === "/chapter/47598/5237906")!;
    assert.equal(notice.chapNum, -1);
    assert.equal(notice.title, "Notice.10");
    assert.ok(notice.sortingIndex! > all.find((c) => c.chapNum === 136)!.sortingIndex!);
    assert.equal(all.find((c) => c.chapNum === 136)!.volume, 2);
    assert.ok(all.some((c) => c.chapNum === 0));
    const unique = parseChapters($, manga, ["en", "es"], true);
    assert.equal(unique.length, 5);
    assert.ok(unique.some((c) => c.chapterId === "/chapter/1/10"));
    assert.ok(!unique.some((c) => c.chapterId === "/chapter/2/11"));
    assert.ok(unique.some((c) => c.langCode === "es"));
    assert.equal(unique.filter((c) => c.chapNum === -1).length, 2);
    assert.equal(getPreferences().deduplicateChapters, false);
  });
});

void test("YaoiMe request routing and retry behavior", async (t) => {
  const requests: string[] = [];
  let failFilters = true;
  let failHome = true;
  const taxonomy = flight({
    genres: [{ name: "Boys Love" }],
    tags: [{ name: "Full Color" }],
    types: [{ value: "doujinshi" }],
    statuses: [{ value: "releasing" }],
    content: [{ value: "safe" }],
    demographics: [{ value: "Shoujo" }],
    languages: [{ code: "en" }],
  });
  const card = `<div class="min-w-0"><img src="/i/c/cover"><a class="card-title" href="/series/80778/name">Name</a></div>`;
  Object.defineProperty(globalThis, "Application", {
    configurable: true,
    value: {
      decodeHTMLEntities: (v: string) => v,
      getState: () => undefined,
      Selector: (object: unknown, method: string) => ({ object, method }),
      arrayBufferToUTF8String: (buffer: ArrayBuffer) => new TextDecoder().decode(buffer),
      scheduleRequest: async ({ url }: { url: string }) => {
        requests.push(url);
        let body: string;
        if (url === "https://yaoi.me/browse") {
          if (failFilters) {
            failFilters = false;
            throw new Error("filter connection failed");
          }
          body = taxonomy;
        } else if (url === "https://yaoi.me/") {
          if (failHome) {
            failHome = false;
            throw new Error("home connection failed");
          }
          body = `<div class="section-head"><h2>Popular updates</h2></div><div><a href="/series/80778/name" title="Name"><img src="/i/c/cover"></a></div>`;
        } else if (url.includes("/chapter/")) {
          body = '<a href="/series/80778/name">Name</a>';
        } else if (url.includes("/series/")) {
          body = '<h1>Name</h1><link rel="canonical" href="https://yaoi.me/series/80778/name">';
        } else {
          body = card + (url.includes("page=2") ? "" : '<a rel="next" href="?page=2">Next</a>');
        }
        return [{ status: 200 }, new TextEncoder().encode(body).buffer];
      },
    },
  });
  t.after(() => Reflect.deleteProperty(globalThis, "Application"));
  const { YaoiMe } = await import("../../src/YaoiMe/main");
  const { SECTIONS, SECTION_DEFINITIONS } = await import("../../src/YaoiMe/models");
  await YaoiMe.cloudflareBypassCompleted({ url: "https://yaoi.me", method: "GET" }, [], {});
  await assert.rejects(YaoiMe.getAdvancedSearchForm({ title: "" }), /filter connection failed/);
  const forms = await Promise.all([
    YaoiMe.getAdvancedSearchForm({ title: "" }),
    YaoiMe.getAdvancedSearchForm({ title: "" }),
  ]);
  assert.equal(forms.length, 2);
  assert.equal(requests.filter((url) => url === "https://yaoi.me/browse").length, 2);
  const queryForm = forms[0] as InstanceType<typeof YaoiMeAdvancedSearchForm>;
  await queryForm.handleTagsChange({ "Full%20Color": "included", "Slow%20Burn": "excluded" });
  await queryForm.handleLanguagesChange(["en", "es"]);
  await queryForm.handleStatusesChange(["releasing"]);
  await queryForm.handleDemographicsChange(["Shoujo"]);
  await YaoiMe.getSearchResults(
    { title: "", metadata: queryForm.getSearchQueryMetadata() },
    undefined,
  );
  const filtered = new globalThis.URL(requests.at(-1)!);
  assert.equal(filtered.searchParams.get("langs"), "en,es");
  assert.equal(filtered.searchParams.has("lang"), false);
  assert.equal(filtered.searchParams.get("tags"), "Full Color");
  assert.equal(filtered.searchParams.get("withoutTags"), "Slow Burn");
  assert.equal(filtered.searchParams.get("status"), "releasing");
  assert.equal(filtered.searchParams.get("demographic"), "Shoujo");
  await queryForm.handleLanguagesChange([]);
  await queryForm.handleTypesChange([]);
  await queryForm.handleRatingsChange([]);
  await YaoiMe.getSearchResults(
    { title: "", metadata: queryForm.getSearchQueryMetadata() },
    undefined,
  );
  const cleared = new globalThis.URL(requests.at(-1)!);
  for (const key of ["langs", "type", "content"])
    assert.equal(cleared.searchParams.has(key), false);
  const trending = await YaoiMe.getDiscoverSectionItems(
    SECTION_DEFINITIONS[SECTIONS.TRENDING],
    undefined,
  );
  assert.match(requests.at(-1)!, /^https:\/\/yaoi.me\/discover\/trending/);
  assert.deepEqual(trending.metadata, { page: 2 });
  const lastPage = await YaoiMe.getDiscoverSectionItems(
    SECTION_DEFINITIONS[SECTIONS.TRENDING],
    trending.metadata,
  );
  assert.match(requests.at(-1)!, /page=2/);
  assert.equal("metadata" in lastPage, false);
  await assert.rejects(
    YaoiMe.getDiscoverSectionItems(SECTION_DEFINITIONS[SECTIONS.POPULAR], undefined),
    /home connection failed/,
  );
  assert.equal(
    (await YaoiMe.getDiscoverSectionItems(SECTION_DEFINITIONS[SECTIONS.POPULAR], undefined)).items
      .length,
    1,
  );
  for (const link of [
    "https://yaoi.me/series/80778/",
    "https://yaoi.me/chapter/80778/5461557/?x=1",
  ]) {
    const result = await YaoiMe.getSearchResults({ title: link }, undefined);
    assert.equal(result.items[0].mangaId, "/series/80778/name");
  }
});
