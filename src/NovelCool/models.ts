/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";
import type { CheerioAPI } from "cheerio";

export const DOMAIN = "https://www.novelcool.com";

export const SECTIONS = {
  FEATURED: "featured",
  LATEST: "latest",
  POPULAR: "popular",
  COMPLETED: "completed",
  TYPES: "types",
} as const;

export const CATEGORY_PATHS = {
  RATING: "/category/index.html",
  LATEST: "/category/latest.html",
  POPULAR: "/category/popular.html",
  NEWEST: "/category/new_list.html",
  COMPLETED: "/category/completed.html",
} as const;

export const STATE_KEYS = {
  RELATIVE_DATE_ANCHOR: "novelcool_relative_date_anchor",
} as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest" },
  { id: "popular", label: "Popular" },
  { id: "newest", label: "Newest" },
  { id: "rating", label: "Rating" },
];

export const MATCH_OPTIONS: Tag[] = [
  { id: "contain", title: "Contain" },
  { id: "begin", title: "Begin" },
  { id: "end", title: "End" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "1", title: "Ongoing" },
  { id: "2", title: "Completed" },
];

export const RATING_OPTIONS: Tag[] = [
  { id: "5", title: "5 Stars" },
  { id: "4", title: "4 Stars and Up" },
  { id: "3", title: "3 Stars and Up" },
  { id: "2", title: "2 Stars and Up" },
];

export const TYPE_TITLES = new Set([
  "comic",
  "comics",
  "manga",
  "manhua",
  "manhwa",
  "novel",
  "web comic",
  "web novel",
  "webtoon",
  "webtoons",
]);

export interface PageMetadata extends JSONObject {
  page: number;
}

export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  nameMethod?: string[];
  author?: string;
  authorMethod?: string[];
  status?: string[];
  genres?: TriState;
  year?: string[];
  rating?: string[];
}

export interface SearchRequest {
  page: number;
  title?: string;
  nameMethod?: string;
  author?: string;
  authorMethod?: string;
  status?: string;
  genresInclude?: string[];
  genresExclude?: string[];
  year?: string;
  rating?: string;
}

export interface ListingChapter {
  chapterId: string;
  title: string;
  dateText?: string;
}

export interface ListingItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  type?: string;
  status?: string;
  rating?: number;
  description?: string;
  genres: string[];
  updatedText?: string;
  latestChapter?: ListingChapter;
}

export interface SearchOptions {
  genres: Tag[];
  years: Tag[];
}

export interface FetchedDocument {
  $: CheerioAPI;
  url: string;
}
