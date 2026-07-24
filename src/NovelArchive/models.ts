/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://novelarchive.cc";
export const API_URL = "https://novelarchive.cc/api";
export const PAGE_SIZE = 24;

export const NATIVE_VERSION = "📖 NovelArchive";
export const AGGREGATOR_ICON = "🌐";

export const SECTIONS = {
  TRENDING: "trending",
  POPULAR: "popular",
  LATEST: "latest",
  EDITORS: "editors",
  TOP_RATED: "top-rated",
  MOST_CHAPTERS: "most-chapters",
  GENRES: "genres",
} as const;

export const ADULT_EXCLUSIONS = [
  "adult",
  "smut",
  "mature",
  "erotica",
  "ecchi",
  "hentai",
  "explicit",
  "sexual content",
  "nsfw",
  "r-18",
  "lewd",
  "pornographic",
];

export const ADULT_RATING_GENRES = [
  "adult",
  "smut",
  "mature",
  "erotica",
  "ecchi",
  "hentai",
  "explicit",
  "nsfw",
  "r-18",
  "lewd",
];

export type PageMetadata = { page?: number };

export type TriState = Record<string, "included" | "excluded">;

export type SearchMetadata = {
  status?: string[];
  ai?: string[];
  genreMatch?: string[];
  genres?: TriState;
};

export type OptionItem = {
  id: string;
  value: string;
};

export interface Novel {
  id: number | string;
  title: string;
  author?: string | null;
  genres?: string | null;
  cover_url?: string | null;
  image_url?: string | null;
  novel_image?: string | null;
  associated_names?: string[] | null;
  description?: string | null;
  total_chapters?: string | number | null;
  views?: number | null;
  views_number?: number | null;
  rating?: number | null;
  rating_count?: number | null;
  latest_release?: string | null;
  release_status?: string | null;
  ongoing?: string | null;
  updated_at?: string | null;
  chapter_names?: string[] | null;
}

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_prev: boolean;
  has_next: boolean;
}

export interface NovelListResponse {
  novels?: Novel[];
  pagination?: Pagination;
}

export interface ChapterContent {
  number?: number;
  name?: string;
  content?: string | null;
}

export interface ChapterContentResponse {
  chapter?: ChapterContent;
  content?: string | null;
}

export interface NovelSource {
  id: string;
  label?: string | null;
}

export interface SourceListResponse {
  sources?: NovelSource[];
}

export interface SourceChapterEntry {
  number: number | string;
  title?: string | null;
}

export interface SourceChapterListResponse {
  chapters?: SourceChapterEntry[];
}

export interface SourceChapterContentResponse {
  content_html?: string | null;
  content?: string | null;
  chapter?: { content_html?: string | null; content?: string | null } | null;
}

export const SORT_OPTIONS: OptionItem[] = [
  { id: "recent", value: "Recent" },
  { id: "popular", value: "Popular" },
  { id: "rating", value: "Top Rated" },
  { id: "chapters", value: "Chapters" },
  { id: "views", value: "Most Viewed" },
];

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "all", value: "All" },
  { id: "ongoing", value: "Ongoing" },
  { id: "completed", value: "Done" },
  { id: "hiatus", value: "Hiatus" },
];

export const GENRE_MATCH_OPTIONS: OptionItem[] = [
  { id: "all", value: "AND" },
  { id: "any", value: "OR" },
];

export const AI_OPTIONS: OptionItem[] = [
  { id: "include", value: "Include" },
  { id: "exclude", value: "Exclude" },
  { id: "only", value: "Only" },
];

export const GENRES: OptionItem[] = [
  { id: "action", value: "Action" },
  { id: "adult", value: "Adult" },
  { id: "adventure", value: "Adventure" },
  { id: "comedy", value: "Comedy" },
  { id: "drama", value: "Drama" },
  { id: "ecchi", value: "Ecchi" },
  { id: "fantasy", value: "Fantasy" },
  { id: "gender-bender", value: "Gender Bender" },
  { id: "harem", value: "Harem" },
  { id: "historical", value: "Historical" },
  { id: "horror", value: "Horror" },
  { id: "isekai", value: "Isekai" },
  { id: "josei", value: "Josei" },
  { id: "martial-arts", value: "Martial Arts" },
  { id: "mature", value: "Mature" },
  { id: "mecha", value: "Mecha" },
  { id: "mystery", value: "Mystery" },
  { id: "psychological", value: "Psychological" },
  { id: "romance", value: "Romance" },
  { id: "school-life", value: "School Life" },
  { id: "sci-fi", value: "Sci-fi" },
  { id: "seinen", value: "Seinen" },
  { id: "shoujo", value: "Shoujo" },
  { id: "shounen", value: "Shounen" },
  { id: "slice-of-life", value: "Slice of Life" },
  { id: "smut", value: "Smut" },
  { id: "sports", value: "Sports" },
  { id: "supernatural", value: "Supernatural" },
  { id: "tragedy", value: "Tragedy" },
  { id: "wuxia", value: "Wuxia" },
  { id: "xianxia", value: "Xianxia" },
  { id: "xuanhuan", value: "Xuanhuan" },
  { id: "yaoi", value: "Yaoi" },
  { id: "yuri", value: "Yuri" },
];
