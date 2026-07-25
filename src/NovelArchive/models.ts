/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ContentRating, SortingOption } from "@paperback/types";

export const DOMAIN = "https://novelarchive.cc";
export const API_URL = `${DOMAIN}/api`;
export const PAGE_SIZE = 24;

// Distinguishes chapters hosted by the site itself from chapters mirrored
// in from its alternate sources.
export const NATIVE_VERSION = "NovelArchive";

export const SECTIONS = {
  TRENDING: "trending",
  POPULAR: "popular",
  LATEST: "latest",
  EDITORS: "editors",
  TOP_RATED: "top-rated",
  MOST_CHAPTERS: "most-chapters",
  GENRES: "genres",
} as const;

// Sent to the API's genres_exclude parameter, which matches the display
// names the site uses for genres.
export const ADULT_EXCLUSIONS = [
  "Adult",
  "Smut",
  "Mature",
  "Erotica",
  "Ecchi",
  "Hentai",
  "Explicit",
  "Sexual Content",
  "NSFW",
  "R-18",
  "Lewd",
  "Pornographic",
];

// Lowercased genres that classify a title's contentRating (distinct from
// ADULT_EXCLUSIONS above, which are display names sent to the filter).
export const ADULT_RATING_GENRES = [
  "adult",
  "smut",
  "erotica",
  "hentai",
  "explicit",
  "nsfw",
  "r-18",
  "lewd",
];

export const MATURE_RATING_GENRES = ["mature", "ecchi"];

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
  release_status?: string | null;
  ongoing?: string | null;
  updated_at?: string | null;
  chapter_names?: string[] | null;
}

// Normalized listing shape produced once by parseNovelList; the discover and
// search handlers map it to their specific item type at the call site.
export interface NovelListItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  contentRating: ContentRating;
  genres: string[];
  summary?: string;
  rating?: number;
  views?: number;
  chapterCount: number;
  publishDate?: Date;
}

export interface NovelListResponse {
  novels?: Novel[];
  pagination?: { has_next?: boolean };
}

export interface ChapterContentResponse {
  chapter?: { content?: string | null };
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

// Single consumer (getSortingOptions), so declared in its final shape.
export const SORT_OPTIONS: SortingOption[] = [
  { id: "recent", label: "Recent" },
  { id: "popular", label: "Popular" },
  { id: "rating", label: "Top Rated" },
  { id: "chapters", label: "Chapters" },
  { id: "views", label: "Most Viewed" },
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
