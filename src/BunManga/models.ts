/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ContentRating, JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://bunmanga.com";
export const MIRRORS = [DOMAIN, "https://manhuahot.com"];
export const STATE_KEYS = { ACTIVE_BASE_URL: "bunmanga_active_base_url" } as const;
export const PAGE_SIZE = 12;
export const MIRROR_PAGE_SIZE = 10;
export const MIRROR_GENRES: Record<string, string> = {
  adventure: "adventure-1",
  comedy: "comedy-1",
  drama: "drama-1",
  fantasy: "fantasy-1",
  historical: "historical-1",
  manga: "mangas",
  manhua: "manhuas",
  manhwa: "manhwas",
  romance: "romances",
  "school-life": "school-life-s",
  "shounen-ai": "shounen-ai-s",
  "soft-yaoi": "soft-yaoi-s",
  webtoon: "webtoon-s",
  yaoi: "yaoi-s",
};

export const SECTIONS = {
  POPULAR: "popular",
  TOP_DAILY: "top_daily",
  LATEST_UPDATES: "latest_updates",
  RELEVANCE: "relevance",
  TOP_RATED: "top_rated",
  TRENDING: "trending",
  GENRES: "genres",
} as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "relevance", label: "Relevance" },
  { id: "latest", label: "Latest" },
  { id: "alphabet", label: "A-Z" },
  { id: "rating", label: "Rating" },
  { id: "trending", label: "Trending" },
  { id: "views", label: "Most Views" },
  { id: "new-manga", label: "New" },
];

export const GENRE_MATCH_OPTIONS: Tag[] = [
  { id: "or", title: "OR" },
  { id: "and", title: "AND" },
];

export const ADULT_OPTIONS: Tag[] = [
  { id: "all", title: "All" },
  { id: "0", title: "Exclude Adult" },
  { id: "1", title: "Adult Only" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "on-going", title: "Ongoing" },
  { id: "end", title: "Completed" },
  { id: "canceled", title: "Canceled" },
  { id: "on-hold", title: "On Hold" },
  { id: "upcoming", title: "Upcoming" },
];

export type TriState = Record<string, "included" | "excluded">;

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  genreMatch?: string[];
  author?: string;
  artist?: string;
  releaseYear?: string;
  adult?: string[];
  statuses?: string[];
}

export interface SearchRequest {
  title?: string;
  sortBy?: string;
  genres?: string[];
  genreMatch?: "and" | "or";
  author?: string;
  artist?: string;
  releaseYear?: string;
  adult?: string;
  statuses?: string[];
}

export interface ListingChapter {
  chapterId: string;
  title: string;
  publishDate?: Date;
}

export interface MangaListItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  contentRating: ContentRating;
  genres: string[];
  chapter?: ListingChapter;
  alternativeTitle?: string;
  status?: string;
  rating?: number;
}
