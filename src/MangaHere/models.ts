/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://www.mangahere.cc";

export const STATE_KEYS = {
  SHOW_ADULT: "mangahere_show_adult",
} as const;

export const SECTIONS = {
  POPULAR: "popular",
  RECOMMENDED: "recommended",
  NEW: "new",
  LATEST: "latest",
  RANKING: "ranking",
  READING_NOW: "reading-now",
  TRENDING: "trending",
  HOT: "hot",
  GENRES: "genres",
} as const;

export const HOME_TITLES = {
  RECOMMENDED: "Recommended",
  NEW: "New Manga Release",
  READING_NOW: "Being Read Right Now",
  TRENDING: "Trending Manga",
  HOT: "Hot Manga Releases",
} as const;

export const RANKING_PERIODS = [
  { id: "daily", title: "Daily", path: "dayranking", className: "dayrank" },
  { id: "weekly", title: "Weekly", path: "weekranking", className: "weekrank" },
  { id: "monthly", title: "Monthly", path: "monthranking", className: "monthrank" },
] as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "po", label: "Popular" },
  { id: "news", label: "New" },
  { id: "latest", label: "Chapter" },
  { id: "rating", label: "Ratings" },
  { id: "az", label: "Alphabetical" },
];

export const GENRES = [
  { id: "1", title: "Action", slug: "action" },
  { id: "2", title: "Adventure", slug: "adventure" },
  { id: "3", title: "Comedy", slug: "comedy" },
  { id: "4", title: "Fantasy", slug: "fantasy" },
  { id: "5", title: "Historical", slug: "historical" },
  { id: "6", title: "Horror", slug: "horror" },
  { id: "7", title: "Martial Arts", slug: "martial-arts" },
  { id: "8", title: "Mystery", slug: "mystery" },
  { id: "9", title: "Romance", slug: "romance" },
  { id: "10", title: "Shounen Ai", slug: "shounen-ai" },
  { id: "11", title: "Supernatural", slug: "supernatural" },
  { id: "12", title: "Drama", slug: "drama" },
  { id: "13", title: "Shounen", slug: "shounen" },
  { id: "14", title: "School Life", slug: "school-life" },
  { id: "15", title: "Shoujo", slug: "shoujo" },
  { id: "16", title: "Gender Bender", slug: "gender-bender" },
  { id: "17", title: "Josei", slug: "josei" },
  { id: "18", title: "Psychological", slug: "psychological" },
  { id: "19", title: "Seinen", slug: "seinen" },
  { id: "20", title: "Slice of Life", slug: "slice-of-life" },
  { id: "21", title: "Sci-fi", slug: "sci-fi" },
  { id: "22", title: "Ecchi", slug: "ecchi" },
  { id: "23", title: "Harem", slug: "harem" },
  { id: "24", title: "Shoujo Ai", slug: "shoujo-ai" },
  { id: "25", title: "Yuri", slug: "yuri" },
  { id: "26", title: "Mature", slug: "mature" },
  { id: "27", title: "Tragedy", slug: "tragedy" },
  { id: "28", title: "Yaoi", slug: "yaoi" },
  { id: "29", title: "Doujinshi", slug: "doujinshi" },
  { id: "30", title: "Sports", slug: "sports" },
  { id: "31", title: "Adult", slug: "adult" },
  { id: "32", title: "One Shot", slug: "one-shot" },
  { id: "33", title: "Smut", slug: "smut" },
  { id: "34", title: "Mecha", slug: "mecha" },
  { id: "35", title: "Shotacon", slug: "shotacon" },
  { id: "36", title: "Lolicon", slug: "lolicon" },
  { id: "37", title: "Webtoons", slug: "webtoons" },
] as const;

export const TYPE_OPTIONS: Tag[] = [
  { id: "0", title: "Any" },
  { id: "1", title: "Japanese Manga" },
  { id: "2", title: "Korean Manhwa" },
  { id: "3", title: "Chinese Manhua" },
  { id: "4", title: "European Manga" },
  { id: "5", title: "American Manga" },
  { id: "6", title: "Hong Kong Manga" },
  { id: "7", title: "Other Manga" },
];

export const MATCH_OPTIONS: Tag[] = [
  { id: "cw", title: "Contains" },
  { id: "bw", title: "Begins with" },
  { id: "ew", title: "Ends with" },
];

export const YEAR_OPTIONS: Tag[] = [
  { id: "eq", title: "On" },
  { id: "lt", title: "Before" },
  { id: "gt", title: "After" },
];

export const RATING_MATCH_OPTIONS: Tag[] = [
  { id: "eq", title: "Is" },
  { id: "lt", title: "Less than" },
  { id: "gt", title: "More than" },
];

export const RATING_OPTIONS: Tag[] = [
  { id: "", title: "Any star" },
  { id: "0", title: "No star" },
  { id: "1", title: "1 star" },
  { id: "2", title: "2 stars" },
  { id: "3", title: "3 stars" },
  { id: "4", title: "4 stars" },
  { id: "5", title: "5 stars" },
];

export const COMPLETION_OPTIONS: Tag[] = [
  { id: "0", title: "Either" },
  { id: "2", title: "Completed" },
  { id: "1", title: "Ongoing" },
];

export type TriState = Record<string, "included" | "excluded">;

export interface PageMetadata extends JSONObject {
  page?: number;
}

export interface SearchMetadata extends JSONObject {
  type?: string[];
  nameMatch?: string[];
  author?: string;
  authorMatch?: string[];
  artist?: string;
  artistMatch?: string[];
  genres?: TriState;
  released?: string;
  releasedMatch?: string[];
  rating?: string[];
  ratingMatch?: string[];
  completion?: string[];
  rankingPeriod?: string;
}

export interface SearchRequest {
  title?: string;
  name?: string;
  nameMethod?: string;
  author?: string;
  authorMethod?: string;
  artist?: string;
  artistMethod?: string;
  type?: string;
  includedGenres?: string[];
  excludedGenres?: string[];
  released?: string;
  releasedMethod?: string;
  rating?: string;
  ratingMethod?: string;
  completion?: string;
}

export interface ListingChapter {
  chapterId: string;
  label: string;
  chapNum?: number;
  volume?: number;
}

export interface MangaListItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  genres: string[];
  rating?: number;
  author?: string;
  status?: string;
  views?: number;
  rank?: number;
  chapter?: ListingChapter;
  updatedAt?: Date;
}

export interface ReaderMetadata {
  chapterId: string;
  imageCount: number;
}
