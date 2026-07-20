/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// Scans.GG serves everything from a bespoke JSON API (api.scans.gg); the
// website itself is only used for share/webview URLs and the Referer header.

import type { JSONObject } from "@paperback/types";

/** Reader-facing website — used for `shareUrl`, webview and the Referer. */
export const DEFAULT_DOMAIN = "https://scans.gg";

/** JSON API host. Every listing/detail/page request goes here. */
export const DEFAULT_API_URL = "https://api.scans.gg";

/** CDN hosting covers and chapter pages. */
export const CDN_URL = "https://cdn.scans.gg/uploads";

// Page sizes. `/series` doesn't return a pagination envelope, so we infer
// "has next page" by comparing the returned count against the limit.
export const SERIES_PAGE_SIZE = 21;
export const LATEST_PAGE_SIZE = 14;
// Fetch beyond the website's seven-card preview so local SFW/hidden-genre
// filtering can backfill a full Paperback results row.
export const POPULAR_FETCH_SIZE = 50;
export const CHAPTER_PAGE_SIZE = 100;

/** Persisted-settings keys. */
export const BASE_URL_KEY = "scansgg.baseUrlOverride";
export const API_URL_KEY = "scansgg.apiUrlOverride";
export const CONTENT_PREFERENCE_KEY = "scansgg.contentPreference";
export const HIDDEN_GENRES_KEY = "scansgg.hiddenGenres";

// One UA for every request class (API, documents, images, WebView, and the
// Cloudflare bypass) — cf_clearance cookies are bound to the exact UA string,
// so mixing agents invalidates a solved challenge.
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/138.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// API response DTOs (only the fields this extension consumes)
// ---------------------------------------------------------------------------

/** Every endpoint wraps its payload in `{ data, meta? }`. */
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

/** A series/manga as returned by `/series` (listing and detail share it). */
export interface SeriesDto {
  id: number;
  title: string;
  summary?: string | null;
  /** CDN cover filename; can be an empty string when no cover is set. */
  cover?: string | null;
  author?: string[] | null;
  artist?: string[] | null;
  /** Numeric tag ids; resolved to names through `TAGS_MAP`. */
  tags?: number[] | null;
  status?: number | null;
  /** Numeric type id; resolved through `TYPE_NAMES`. */
  type?: number | null;
  /** Site's own rating tier: 1 safe, 2 suggestive, 3 mature, 4+ adult. */
  content_rating?: number | null;
  /** Average reader-review score on the site's five-star scale. */
  rating?: number | null;
  rating_count?: number | null;
  views?: number | null;
  /** Views accumulated inside the requested popular timeframe. */
  popular_views?: number | null;
  alternative_titles?: AlternativeTitleDto[] | null;
  /** Free-text theme names (in addition to the numeric `tags`). */
  themes?: string[] | null;
  /** Only present on the `series_details=true` latest feed. */
  chapters?: LatestChapterDto[] | null;
}

export interface AlternativeTitleDto {
  language?: string | null;
  title?: string | null;
}

/** Slim chapter attached to a series on the latest feed. */
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

/** A chapter as returned by `/chapters`. */
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

/** Page-list payload from `/chapter-navigation` (pages nested under `chapter`). */
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

// ---------------------------------------------------------------------------
// Discover / search metadata
// ---------------------------------------------------------------------------

/** Cursor for filtered `/series` pagination. */
export interface Metadata extends JSONObject {
  offset?: number;
  page?: number;
  index?: number;
}

export type TriStateValue = "included" | "excluded";
export type TriStateSelection = Record<string, TriStateValue>;
export type TagMatchMode = "and" | "or";
export type PopularRange = (typeof POPULAR_RANGE_OPTIONS)[number]["id"];

/** Advanced-search selections keyed by the numeric ids used by the API. */
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

// ---------------------------------------------------------------------------
// Filter option sets (ids are the values the API expects)
// ---------------------------------------------------------------------------

/** Numeric type id → display name (matches the search filter ids). */
export const TYPE_NAMES: Record<number, string> = {
  1: "Comic",
  2: "Manga",
  3: "Manhwa",
  4: "Manhua",
  5: "Webtoon",
};

export const TYPE_OPTIONS: OptionItem[] = [
  { id: "1", value: "Comic" },
  { id: "2", value: "Manga" },
  { id: "3", value: "Manhwa" },
  { id: "4", value: "Manhua" },
  { id: "5", value: "Webtoon" },
];

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "1", value: "Ongoing" },
  { id: "2", value: "Completed" },
  { id: "3", value: "Hiatus" },
  { id: "4", value: "Cancelled" },
  { id: "5", value: "Dropped" },
];

/** Time windows accepted by `/series?popular=...`, matching the website picker. */
export const POPULAR_RANGE_OPTIONS = [
  { id: "daily", value: "1 Day" },
  { id: "weekly", value: "7 Days" },
  { id: "monthly", value: "1 Month" },
  { id: "3months", value: "3 Months" },
  { id: "6months", value: "6 Months" },
  { id: "1year", value: "1 Year" },
] as const;

/** Numeric tag id → display name. */
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

// Tag ids that force a title's content rating up. Explicit adult tags mark a
// title ADULT; softer suggestive/BL-GL tags mark it MATURE so it isn't shown
// to readers who keep those categories hidden.
export const ADULT_TAG_IDS = new Set<number>([33, 34, 35, 38, 40, 44]);
export const MATURE_TAG_IDS = new Set<number>([21, 24, 27, 28, 29, 30, 31, 37, 42]);

// API status code → Paperback status string. The numbering matches the site's
// own status filter, so Hiatus/Dropped are surfaced distinctly instead of
// being collapsed into "Cancelled".
export function mapStatus(status?: number | null): string {
  switch (status) {
    case 1:
      return "Ongoing";
    case 2:
      return "Completed";
    case 3:
      return "Hiatus";
    case 4:
      return "Cancelled";
    case 5:
      return "Dropped";
    default:
      return "Unknown";
  }
}
