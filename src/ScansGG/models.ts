/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject } from "@paperback/types";
export const DEFAULT_DOMAIN = "https://scans.gg";
export const DEFAULT_API_URL = "https://api.scans.gg";
export const CDN_URL = "https://cdn.scans.gg/uploads";

export const SERIES_PAGE_SIZE = 21;
export const LATEST_PAGE_SIZE = 14;
export const POPULAR_FETCH_SIZE = 50;
export const CHAPTER_PAGE_SIZE = 100;
export const TOP_MANGA_SIZE = 7;
export const MAX_CHAPTER_PAGES = 200;
export const MAX_FILTER_BATCHES = 10;

export const SECTIONS = {
  POPULAR: "popular",
  POPULAR_RANGES: "popular_ranges",
  LATEST: "latest",
  ALL_SERIES: "all_series",
  GENRES: "genres",
} as const;
export const BASE_URL_KEY = "scansgg.baseUrlOverride";
export const API_URL_KEY = "scansgg.apiUrlOverride";
export const CONTENT_PREFERENCE_KEY = "scansgg.contentPreference";
export const HIDDEN_GENRES_KEY = "scansgg.hiddenGenres";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/138.0.0.0 Safari/537.36";

export interface ResponseDto<T> {
  data: T;
  meta?: MetaDto | null;
}

export interface MetaDto {
  has_more?: boolean;
  page?: number;
  limit?: number;
  offset?: number;
  count?: number;
}
export interface SeriesDto {
  id: number;
  title: string;
  summary?: string | null;
  cover?: string | null;
  author?: string[] | null;
  artist?: string[] | null;
  tags?: number[] | null;
  status?: number | null;
  type?: number | null;
  content_rating?: number | null;
  rating?: number | null;
  rating_count?: number | null;
  views?: number | null;
  popular_views?: number | null;
  alternative_titles?: AlternativeTitleDto[] | null;
  themes?: string[] | null;
  chapters?: LatestChapterDto[] | null;
}

export interface AlternativeTitleDto {
  language?: string | null;
  title?: string | null;
}
export interface LatestChapterDto {
  id?: number;
  number?: number | string;
  created_at?: string | null;
  updated_at?: string | null;
  views?: number | null;
  group_id?: number | null;
  group?: GroupDto | null;
  collab_groups?: GroupDto[] | null;
}
export interface ChapterDto {
  id: number;
  number: number | string;
  title?: string | null;
  created_at?: string | null;
  group_id?: number | null;
  group?: GroupDto | null;
  collab_groups?: GroupDto[] | null;
}

export interface GroupDto {
  id?: number | null;
  title?: string | null;
}
export interface PageListDto {
  chapter?: ChapterPagesDto | null;
}

export interface ChapterPagesDto {
  id?: number | null;
  pages?: PageDto[] | null;
}

export interface PageDto {
  position: number;
  path: string;
}

export interface Metadata extends JSONObject {
  offset?: number;
  page?: number;
  index?: number;
}

export type TriStateValue = "included" | "excluded";
export type TriStateSelection = Record<string, TriStateValue>;
export type TagMatchMode = "and" | "or";
export type PopularRange = (typeof POPULAR_RANGE_OPTIONS)[number]["id"];
export type SearchMetadata = {
  types?: TriStateSelection;
  statuses?: TriStateSelection;
  tags?: TriStateSelection;
  tagMatchMode?: TagMatchMode;
  popularRange?: PopularRange;
};

export interface OptionItem {
  id: string;
  value: string;
}

export const TYPE_NAMES: Record<number, string> = {
  1: "Comic",
  2: "Manga",
  3: "Manhwa",
  4: "Manhua",
  5: "Webtoon",
};

export const TYPE_OPTIONS: OptionItem[] = Object.entries(TYPE_NAMES).map(([id, value]) => ({
  id,
  value,
}));

export const STATUS_MAP: Record<number, string> = {
  1: "Ongoing",
  2: "Completed",
  3: "Hiatus",
  4: "Cancelled",
  5: "Dropped",
};

export const STATUS_OPTIONS: OptionItem[] = Object.entries(STATUS_MAP).map(([id, value]) => ({
  id,
  value,
}));
export const POPULAR_RANGE_OPTIONS = [
  { id: "daily", value: "1 Day" },
  { id: "weekly", value: "7 Days" },
  { id: "monthly", value: "1 Month" },
  { id: "3months", value: "3 Months" },
  { id: "6months", value: "6 Months" },
  { id: "1year", value: "1 Year" },
] as const;
export const TAGS_MAP: Record<number, string> = {
  1: "Fantasy",
  2: "Romance",
  3: "Shoujo",
  4: "Comedy",
  5: "Drama",
  6: "Slice Of Life",
  7: "School Life",
  8: "Thriller",
  9: "Josei",
  10: "Action",
  11: "Seinen",
  12: "Historical",
  13: "Shounen",
  14: "Sports",
  15: "Supernatural",
  16: "Adventure",
  17: "Sci-fi",
  18: "Martial Arts",
  19: "Mystery",
  20: "Horror",
  21: "Mature",
  22: "Psychological",
  23: "Suspense",
  24: "Gender Bender",
  25: "Tragedy",
  26: "Harem",
  27: "Boys Love",
  28: "Shounen Ai",
  29: "Yaoi",
  30: "Shoujo Ai",
  31: "Yuri",
  32: "Gourmet",
  33: "Adult",
  34: "Erotica",
  35: "Smut",
  36: "Music",
  37: "Ecchi",
  38: "Shotacon",
  39: "Mecha",
  40: "Hentai",
  41: "Girls Love",
  42: "Doujinshi",
  43: "Mahou Shoujo",
  44: "Lolicon",
  45: "Award Winning",
  46: "Avant Garde",
  47: "Survival",
  48: "Male Protagonist",
  49: "Regression",
};

export const TAG_OPTIONS: OptionItem[] = Object.entries(TAGS_MAP)
  .map(([id, value]) => ({ id, value }))
  .sort((a, b) => a.value.localeCompare(b.value));

export const ADULT_TAG_IDS = new Set<number>([33, 34, 35, 38, 40, 44]);
export const MATURE_TAG_IDS = new Set<number>([21, 24, 27, 28, 29, 30, 31, 37, 42]);

export const mapStatus = (status?: number | null): string => {
  return status != null && status in STATUS_MAP ? STATUS_MAP[status] : "Unknown";
};
