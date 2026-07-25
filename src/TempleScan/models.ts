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
  price?: number;
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
