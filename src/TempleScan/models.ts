/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
} from "@paperback/types";

export const DOMAIN = "https://templetoons.com";
export const API_URL = "https://api.templetoons.com/api";
export const PAID_CHAPTER_SUFFIX = "#paid";

export const PAGE_SIZE = 20;

export interface BrowseSeries {
  series_slug: string;
  title: string;
  alternative_names?: string | null;
  thumbnail?: string | null;
  status?: string | null;
  update_chapter?: string | null;
  created_at?: string | null;
  total_views?: number;
}

export interface SeasonChapter {
  chapter_slug: string;
  chapter_name?: string | null;
  chapter_title?: string | null;
  created_at?: string | null;
  price?: number | null;
  index?: string | number;
}

export interface SeriesData {
  series_slug: string;
  title: string;
  description?: string | null;
  author?: string | null;
  studio?: string | null;
  badge?: string | null;
  status?: string | null;
  release_year?: string | number | null;
  alternative_names?: string | null;
  thumbnail?: string | null;
  total_views?: number;
  tag_series?: { tag?: { name?: string } }[];
  Season?: { Chapter?: SeasonChapter[] }[];
}

// Homepage cards: "Comics Update" entries carry their newest chapters,
// "New Series" entries do not.
export interface HomeSeries {
  series_slug: string;
  title: string;
  thumbnail?: string | null;
  badge?: string | null;
  Chapter?: SeasonChapter[];
}

export interface HomeSections {
  newSeries: HomeSeries[];
  updates: HomeSeries[];
}

export interface FeaturedEntry {
  series_slug: string;
  title: string;
  thumbnail?: string | null;
  banner?: string | null;
  protagonist?: string | null;
  description?: string | null;
  author?: string | null;
  total_views?: number;
}

export interface TrendingEntry {
  series_slug: string;
  title: string;
  thumbnail?: string | null;
  badge?: string | null;
  day_views?: number;
  week_views?: number;
  month_views?: number;
}

export interface TrendingResponse {
  dayRes?: TrendingEntry[];
  weekRes?: TrendingEntry[];
  mensualRes?: TrendingEntry[];
}

export type TrendingRange = "day" | "week" | "month";

export type PageMetadata = { page: number };

export interface SearchMetadata extends JSONObject {
  status?: string;
  trending?: TrendingRange;
}

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "views", label: "Most Viewed" },
  { id: "updated", label: "Recently Updated" },
  { id: "created", label: "Newest" },
];

export const STATUS_OPTIONS = [
  { id: "", title: "All" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Completed", title: "Completed" },
  { id: "Canceled", title: "Canceled" },
  { id: "Dropped", title: "Dropped" },
];

export const TRENDING_RANGES: { id: TrendingRange; title: string }[] = [
  { id: "day", title: "Today" },
  { id: "week", title: "This Week" },
  { id: "month", title: "Monthly" },
];

export const SECTIONS = {
  FEATURED: "featured",
  NEW_SERIES: "new-series",
  LATEST: "latest",
  TRENDING: "trending",
} as const;

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
  { id: SECTIONS.NEW_SERIES, title: "New Series", type: DiscoverSectionType.simpleCarousel },
  { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.genres },
];

// === RSC field-key decoding ===
// The site renames a fixed set of Next.js payload field keys to short keys and renames them back
// with a function in its client bundle. The table maps each logical name to the site's current
// short key; it is empty until the site renames anything, so ordinary reads need no WebView.
export type RscTable = Record<string, string>;

export const RSC_KEYS_STATE = "templescan_rsc_keys";

// Validates that the decoder was found: at least one of these must be in the table it returns.
export const RSC_FIELDS = ["title", "series_slug", "Season", "images"];

// Finds the site's RSC key decoder among the page's webpack modules and returns its rename table.
// Run in a WebView confined to the site; a direct port of keiyoushi's decode_rsc_keys.js.
export const DECODE_RSC_KEYS = `async (chunks, keys, fields) => {
  const sources = await Promise.all(chunks.map(async (url) => (await fetch(url)).text()));
  for (const source of sources) {
    if (/^(?:"use strict";)?\\(self\\.webpackChunk\\w*=/.test(source)) (0, eval)(source);
  }
  const probe = Object.fromEntries(keys.map((key) => [key, key]));
  const factories = Object.keys(self)
    .filter((name) => name.startsWith("webpackChunk"))
    .flatMap((name) => self[name])
    .flatMap((entry) => Object.values(entry[1]));
  for (const factory of factories) {
    const module = { exports: {} };
    const require = () => { throw new Error(); };
    require.r = () => {};
    require.d = (target, getters) => {
      for (const name in getters) Object.defineProperty(target, name, { get: getters[name], enumerable: true });
    };
    try { factory(module, module.exports, require); } catch { continue; }
    for (const exported of Object.values(module.exports)) {
      let decoded;
      try { decoded = exported(probe); } catch { continue; }
      if (!decoded || typeof decoded !== "object") continue;
      const table = Object.fromEntries(
        Object.entries(decoded).filter(([name, key]) => name !== key && keys.includes(key)),
      );
      if (fields.some((field) => field in table)) return table;
    }
  }
  return null;
}`;
