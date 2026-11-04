/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";

import * as cheerio from "cheerio";

import {
  parseHomeCards,
  parseBrowseCards,
  toLatestItem,
  toSearchResult,
} from "../../src/YaoiMe/parsers";
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/src/YaoiMe/forms.ts"))
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
  const metadata = new YaoiMeAdvancedSearchForm(
    { title: "" },
    getPreferences(),
    [],
  ).getSearchQueryMetadata();
  assert.ok(Object.values(metadata).every((v) => v !== undefined));
});
