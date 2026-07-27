/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://www.novelcool.com";

export const SECTIONS = {
  FEATURED: "featured",
  LATEST: "latest",
  POPULAR: "popular",
  COMPLETED: "completed",
  TYPES: "types",
} as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "index", label: "Default" },
  { id: "popular", label: "Popular" },
  { id: "latest", label: "Latest" },
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
  { id: "5", title: "5 stars" },
  { id: "4", title: "4 stars and up" },
  { id: "3", title: "3 stars and up" },
  { id: "2", title: "2 stars and up" },
  { id: "1", title: "1 star and up" },
];

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
  sort?: string;
}

export interface ListingItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  type?: string;
  status?: string;
  rating?: number;
  description?: string;
  updatedText?: string;
  updatedDate?: Date;
  latestChapter?: ListingChapter;
}

export interface ListingChapter {
  chapterId: string;
  title: string;
  dateText?: string;
}

export interface ChapterEntry {
  chapterId: string;
  title: string;
  dateText?: string;
}

export interface SearchOptions {
  genres: Tag[];
  years: Tag[];
}
