/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject } from "@paperback/types";

export const DOMAIN = "https://chikari.moe";
export const API_URL = `${DOMAIN}/api`;
export const PAGE_SIZE = 24;
export const TAG_LIMIT = 100;

// Paperback rejects ids containing characters outside this set.
export const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

export const STATE_KEYS = {
  CONTENT_RATINGS: "chikari_content_ratings",
  CONTENT_TYPES: "chikari_content_types",
  EXCLUDED_GENRES: "chikari_excluded_genres",
  EXCLUDED_TAGS: "chikari_excluded_tags",
  SECTION_ORDER: "chikari_section_order",
  SECTIONS_VERSION: "chikari_sections_version",
  VISIBLE_SECTIONS: "chikari_visible_sections",
} as const;

export const DEFAULT_CONTENT_RATINGS: ContentPreferenceRating[] = ["safe", "suggestive"];
export const DEFAULT_CONTENT_TYPES: SeriesType[] = ["manga", "manhwa", "manhua"];

export type ContentPreferenceRating = "safe" | "suggestive" | "erotica" | "pornographic";
export type Medium = "comic" | "novel";
export type Period = "day" | "week" | "month" | "all";
export type SeriesStatus = "releasing" | "completed" | "hiatus" | "cancelled" | "upcoming";
export type SeriesType = "manga" | "manhwa" | "manhua" | "oel" | "novel";
export type SortId = "popular" | "top_rated" | "trending" | "updated" | "added" | "most_bookmarked";

export interface ChikariPreferences {
  adult: boolean;
  contentRatings: ContentPreferenceRating[];
  excludedGenres: string[];
  excludedTags: string[];
  types: SeriesType[];
}

export interface SeriesItem {
  slug: string;
  title: string;
  type: string;
  status: SeriesStatus;
  is_nsfw: boolean;
  chapter_count: number;
  cover_url: string;
  latest_chapter: number | null;
  last_chapter_at: string | null;
  rating: number | null;
  views: number;
  medium?: Medium;
}

export interface HomeRow {
  slug: "trending" | "popular" | "top-rated" | "recently-updated" | "recently-added";
  items: SeriesItem[];
}

export interface HomeResponse {
  rows: HomeRow[];
}

export interface SeriesListResponse {
  items: SeriesItem[];
  total: number;
}

export interface SeriesCredit {
  name: string;
  role: "author" | "artist";
}

export interface SeriesGenre {
  slug: string;
  name: string;
}

export interface SeriesTag {
  id: number;
  name: string;
  is_spoiler: boolean;
}

export interface ChapterItem {
  number: number | null;
  volume: string;
  title: string;
  lang: string;
  created_at: string;
}

export interface SeriesDetails {
  slug: string;
  title: string;
  type: string;
  status: SeriesStatus;
  is_nsfw: boolean;
  chapter_count: number;
  cover_url: string;
  description: string;
  alt_titles: string[];
  authors: SeriesCredit[];
  genres: SeriesGenre[];
  tags: SeriesTag[];
  rating: number | null;
  views: number;
  year: number | null;
  medium?: Medium;
}

export interface ChapterListResponse {
  items: ChapterItem[];
  total: number;
}

export interface ChapterDetailsResponse {
  pages: string[];
}

export interface NovelChapterDetailsResponse {
  body: string;
  locked: boolean;
  lock_reason: string;
}

export interface GenreOption {
  slug: string;
  name: string;
}

export interface TagOption {
  id: number;
  name: string;
  count: number;
}

export interface PageMetadata extends JSONObject {
  offset?: number;
  novelOffset?: number;
}
