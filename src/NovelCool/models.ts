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

export const STATUS_OPTIONS: Tag[] = [
  { id: "0", title: "All" },
  { id: "1", title: "Ongoing" },
  { id: "2", title: "Completed" },
];

export const TYPE_OPTIONS: Tag[] = [
  { id: "novel", title: "Novel" },
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "comic", title: "Comic" },
];

export interface PageMetadata extends JSONObject {
  page: number;
}

export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  author?: string;
  status?: string[];
  genres?: TriState;
  type?: string[];
  year?: string[];
  alphabet?: string[];
}

export interface SearchRequest {
  page: number;
  title?: string;
  author?: string;
  status?: string;
  genresInclude?: string[];
  genresExclude?: string[];
  type?: string;
  year?: string;
  alphabet?: string;
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
  alphabets: Tag[];
}
