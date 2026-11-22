/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Chapter } from "@paperback/types";
import * as cheerio from "cheerio";
import { decodeHTML } from "entities";

import {
  parseHomepageRail,
  parseTrending,
  parseMangaDetails,
  parseChapters,
  parseChapterDetails,
  toFeaturedItem,
  toSimpleItem,
  toChapterUpdateItem,
} from "../../src/Cocomic/parsers";

Object.defineProperty(globalThis, "Application", {
  configurable: true,
  value: { decodeHTMLEntities: decodeHTML, getState: () => undefined },
});

const { Cocomic } = await import("../../src/Cocomic/main");

void test("redesigned home preserves chapter zero, rating, timestamps and missing fields", () => {
  const $ =
    cheerio.load(`<section class="mobile-swimlane-section"><h3 class="swimlane-heading">Latest Updates</h3>
    <div class="mobile-swimlane-card"><a class="swimlane-title" href="/manga/example/">Example</a><img src="/cover.webp">
    <a class="swimlane-chap" href="/manga/example/chapter-0/">Ch. 0</a><span class="swimlane-rating">★ 9.8</span><span class="swimlane-time">17m ago</span></div>
    <div class="mobile-swimlane-card"><a class="swimlane-title" href="/manga/other/">Other</a><img src="/other.webp"></div>
    <div class="mobile-swimlane-card"><a class="swimlane-title" href="/manga/no-cover/">No cover</a></div></section>`);
  const items = parseHomepageRail($, "Latest Updates");
  assert.equal(items.length, 2);
  assert.equal(toSimpleItem(items[0]).subtitle, "Ch. 0 | ★ 9.8");
  assert.equal(toSimpleItem(items[1]).subtitle, undefined);
  const update = toChapterUpdateItem(items[0]);
  assert.equal(update?.chapterId, "chapter-0");
  assert.equal(update?.subtitle, "Ch. 0 | ★ 9.8");
  assert.ok(update?.publishDate instanceof Date);
  assert.ok(Math.abs(Date.now() - update.publishDate.getTime() - 17 * 60000) < 2000);
  assert.equal(items[0].imageUrl, "https://cocomic.co/cover.webp");
});

void test("hero uses homepage synopsis and preserves slides absent from the desktop carousel", () => {
  const $ =
    cheerio.load(`<div class="hero-slide"><a class="hero-actions" href="/manga/example/"></a><div class="hero-actions"><a href="/manga/example/">Read</a></div><div class="hero-synopsis">Available here.</div></div>
    <div class="mobile-hero-slide" style="background-image:url('/cover.webp')"><h3 class="mobile-hero-title">Example</h3><span class="m-genre">Fantasy</span><span class="m-badge-rating">★ 9.8</span><a class="mobile-hero-cta" href="/manga/example/">Read</a></div>
    <div class="mobile-hero-slide" style="background-image:url('/other.webp')"><h3 class="mobile-hero-title">Other</h3><a class="mobile-hero-cta" href="/manga/other/">Read</a></div>`);
  const items = parseTrending($);
  assert.equal(items.length, 2);
  assert.equal(items[0].summary, "Available here.");
  assert.deepEqual(items[0].genres, ["Fantasy"]);
  assert.equal(items[1].summary, undefined);
});

void test("redesigned details, free and paid chapters and reader retain saved IDs", () => {
  const manga = parseMangaDetails(
    cheerio.load(
      `<h1 class="asura-series-title">Example</h1><img class="asura-poster-img" src="/cover.webp"><span class="asura-badge-star">★ 9.8</span><div class="asura-synopsis-content">Synopsis</div>`,
    ),
    "example",
  );
  assert.ok(Math.abs((manga.mangaInfo.rating ?? 0) - 0.98) < 1e-10);
  assert.equal(manga.mangaInfo.synopsis, "Synopsis");
  const chapters = parseChapters(
    cheerio.load(
      `<li class="wp-manga-chapter premium"><a href="/manga/example/chapter-2/">Chapter 2</a></li><li class="wp-manga-chapter"><a href="/manga/example/chapter-0/">Chapter 0</a></li>`,
    ),
    manga,
  );
  assert.deepEqual(
    chapters.map((c) => [c.chapterId, c.chapNum]),
    [
      ["chapter-2#lock", 2],
      ["chapter-0", 0],
    ],
  );
  const chapter: Chapter = {
    ...chapters[1],
    sourceManga: {
      ...manga,
      mangaInfo: { ...manga.mangaInfo, contentRating: ContentRating.EVERYONE },
    },
  };
  const reader = parseChapterDetails(
    cheerio.load(
      '<div class="asura-stream-images"><img data-src="https://cdn.example/page.webp"></div>',
    ),
    chapter,
  );
  assert.ok("pages" in reader);
  assert.deepEqual(reader.pages, ["https://cdn.example/page.webp"]);
  assert.equal(reader.id, "chapter-0");
});

void test("trending hero places at most two genre names beside the rating", () => {
  const item = {
    mangaId: "example",
    title: "Example",
    imageUrl: "https://cocomic.co/cover.webp",
    contentRating: ContentRating.EVERYONE,
    genres: ["Drama", "Fantasy", "Full Color"],
    rating: 9.8,
    chapter: { chapterId: "chapter-0", title: "Ch. 0" },
  };
  const hero = toFeaturedItem(item);
  assert.deepEqual(hero.infoItems, [
    { symbol: "star.fill", text: "9.8" },
    { symbol: "tag.fill", text: "Drama, Fantasy" },
  ]);
  assert.equal(hero.supertitle, undefined);
  assert.deepEqual(toFeaturedItem({ ...item, rating: undefined }).infoItems, [
    { symbol: "tag.fill", text: "Drama, Fantasy" },
  ]);
  assert.equal(toFeaturedItem({ ...item, rating: undefined, genres: [] }).infoItems, undefined);
});

void test("Popular Manga precedes the native Latest Updates carousel", async () => {
  const sections = await Cocomic.getDiscoverSections();
  assert.deepEqual(
    sections.map((section) => section.id),
    ["trending", "trending_now", "popular", "latest_updates", "new_releases", "genres"],
  );
});
