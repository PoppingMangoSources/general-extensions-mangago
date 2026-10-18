/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
} from "@paperback/types";

export const DOMAIN = "https://templetoons.com";
export const PAID_CHAPTER_SUFFIX = "#paid";

export const PAGE_SIZE = 20;

export interface BrowseSeries {
  series_slug: string;
  title: string;
  alternative_names?: string | null;
  thumbnail?: string | null;
  badge?: string | null;
  status?: string | null;
  update_chapter?: string | null;
  created_at?: string | null;
  total_views?: number;
}

// A chapter as the series page's app holds it.
export interface SiteChapter {
  slug: string;
  name?: string | null;
  title?: string | null;
  premium?: boolean | null;
  createdAt?: number | null;
}

// The schema.org block the series page embeds.
export interface ComicSeriesLd {
  "@type"?: string;
  name?: string | null;
  description?: string | null;
  image?: string | null;
  author?: { name?: string | null } | null;
  alternateName?: string | null;
  genre?: string[] | null;
}

export type PageMetadata = { page: number };

export type TrendingRange = "day" | "week" | "month";

export interface SearchMetadata extends JSONObject {
  status?: string;
  trending?: TrendingRange;
}

// The homepage's Trending tabs and the lists behind them.
export const TRENDING_RANGES: { id: TrendingRange; title: string; list: string }[] = [
  { id: "day", title: "Today", list: "dayRes" },
  { id: "week", title: "Week", list: "weekRes" },
  { id: "month", title: "Month", list: "mensualRes" },
];

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

export const SECTIONS = {
  FEATURED: "featured",
  NEW_SERIES: "new-series",
  TRENDING: "trending",
  LATEST: "latest",
} as const;

// In the order of the site's homepage.
export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
  { id: SECTIONS.NEW_SERIES, title: "New Series", type: DiscoverSectionType.simpleCarousel },
  { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.genres },
  { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
];

// The site keeps its data in its app rather than in a stable payload, so a page is loaded in a
// WebView and the data is read from the app's React state, found by its shape.
export type SitePageKind = "catalog" | "chapters" | "pages" | "featured" | "trending";

// How long the app is given to fill in its state, and how long a reader page may go without page
// images before it is taken to have none, as a locked chapter does.
export const SITE_PAGE_TIMEOUT_MS = 30_000;
export const SITE_PAGE_SETTLE_MS = 10_000;

// How long the site's own check is given to pass without a tap.
export const CHALLENGE_TIMEOUT_MS = 30_000;

export const READ_SITE_PAGE = `(kinds, settled) => {
  const isObjects = (v, ...keys) =>
    Array.isArray(v) && v.length > 0 && v[0] !== null && typeof v[0] === "object" && keys.every((k) => k in v[0]);
  const shapes = {
    catalog: (v) => isObjects(v, "series_slug", "title", "total_views"),
    chapters: (v) => isObjects(v, "slug", "createdAt"),
    pages: (v) => Array.isArray(v) && v.length > 0 && typeof v[0] === "string" && v[0].includes("/uploads/"),
    featured: (v) => isObjects(v, "protagonist", "banner"),
    trending: (v) => v !== null && typeof v === "object" && !Array.isArray(v) && "dayRes" in v && "weekRes" in v,
  };
  const find = (matches) => {
    // The shallowest depth each object was searched at; a deeper first visit must not hide it.
    const seen = new Map();
    const search = (value, depth) => {
      if (value === null || typeof value !== "object" || value.$$typeof || seen.get(value) <= depth) return null;
      seen.set(value, depth);
      if (matches(value)) return value;
      // Long arrays are data of another shape; short ones include React's [value, deps] memo pairs.
      if (depth >= 2 || (Array.isArray(value) && value.length > 4)) return null;
      for (const child of Object.values(value)) {
        const found = search(child, depth + 1);
        if (found) return found;
      }
      return null;
    };
    for (const element of document.querySelectorAll("body *")) {
      const fiberKey = Object.keys(element).find((k) => k.startsWith("__reactFiber$"));
      let fiber = fiberKey && element[fiberKey];
      for (let level = 0; fiber && level < 6; level++, fiber = fiber.return) {
        let found = search(fiber.memoizedProps, 0);
        for (let hook = fiber.memoizedState; !found && hook; hook = hook.next) {
          found = search(hook.memoizedState, 0);
        }
        if (found) return found;
      }
    }
    return null;
  };
  const data = {};
  for (const kind of kinds) {
    const found = find(shapes[kind]);
    if (found) data[kind] = found;
  }
  return kinds.every((kind) => kind in data) || settled ? { data } : null;
}`;
