/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DiscoverSectionType, type DiscoverSection, type JSONObject } from "@paperback/types";

export const DOMAIN = "https://ranobes.net";
export const PAGE_SIZE = 20;

export const SECTIONS = {
  FEATURED: "featured",
  LATEST: "latest",
  MOST_VIEWED: "most-viewed",
  MOST_RATED: "most-rated",
  COMPLETED: "completed",
} as const;

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
  { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  {
    id: SECTIONS.MOST_VIEWED,
    title: "Most Viewed Novels",
    type: DiscoverSectionType.prominentCarousel,
  },
  {
    id: SECTIONS.MOST_RATED,
    title: "Most Rated Novels",
    type: DiscoverSectionType.prominentCarousel,
  },
  { id: SECTIONS.COMPLETED, title: "Completed", type: DiscoverSectionType.prominentCarousel },
];

export const SORT_ORDERS = [
  { id: "default", label: "Default" },
  { id: "rating", label: "Rating", sort: "rating", order: "desc" },
  { id: "title_asc", label: "Title (ASC)", sort: "title", order: "asc" },
  { id: "date_desc", label: "New Novels (DESC)", sort: "date", order: "desc" },
  { id: "date_asc", label: "Old Novels (ASC)", sort: "date", order: "asc" },
  {
    id: "comments_desc",
    label: "Comments: Most to least",
    sort: "comm_num",
    order: "desc",
  },
  {
    id: "comments_asc",
    label: "Comments: Least to most",
    sort: "comm_num",
    order: "asc",
  },
  { id: "views_desc", label: "Views: Most to least", sort: "news_read", order: "desc" },
  { id: "views_asc", label: "Views: Least to most", sort: "news_read", order: "asc" },
  {
    id: "chapters_desc",
    label: "Chapters: Most to least",
    sort: "d.chap-num",
    order: "desc",
  },
  {
    id: "chapters_asc",
    label: "Chapters: Least to most",
    sort: "d.chap-num",
    order: "asc",
  },
  { id: "year_desc", label: "Year: Newest to oldest", sort: "d.year", order: "desc" },
  { id: "year_asc", label: "Year: Oldest to newest", sort: "d.year", order: "asc" },
  {
    id: "modified_desc",
    label: "Recently Modified",
    sort: "editdate",
    order: "desc",
  },
] as const;

export const GENRES = [
  "Action",
  "Adult",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Gender Bender",
  "Harem",
  "Historical",
  "Horror",
  "Josei",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-fi",
  "Seinen",
  "Shoujo",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "Tragedy",
  "Wuxia",
  "Xianxia",
  "Xuanhuan",
  "Yaoi",
  "Yuri",
];

export interface PageMetadata extends JSONObject {
  page: number;
  collectedIds?: string[];
}
export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  events?: TriState;
  languages?: TriState;
  translationStatus?: string;
  originalStatus?: string;
  yearFrom?: string;
  yearTo?: string;
  chaptersFrom?: string;
  chaptersTo?: string;
  ratingsFrom?: string;
  ratingsTo?: string;
  authors?: string;
  excludedAuthors?: string;
  translators?: string;
  excludedTranslators?: string;
  publishers?: string;
  excludedPublishers?: string;
  onlyTranslated?: boolean;
  mtlFiles?: boolean;
  mtlReader?: boolean;
  aiTranslated?: boolean;
}

export type OptionItem = { id: string; title: string };

export interface FilterTaxonomy {
  genres: OptionItem[];
  events: OptionItem[];
}

export type ListingType = "stories" | "updates" | "rankings";

export interface RanobesListing {
  mangaId: string;
  title: string;
  imageUrl: string;
  description?: string;
  chapterId?: string;
  chapterTitle?: string;
  publishDate?: Date;
  rating?: number;
  ratingCount?: number;
  views?: number;
  genres?: string[];
}

export interface RanobesChapterEntry {
  id: string;
  title: string;
  date?: string;
  link: string;
}

export interface RanobesChapterPage {
  chapters?: RanobesChapterEntry[];
  pages_count?: number;
  count_all?: number;
  limit?: number;
}

export const LANGUAGE_OPTIONS: OptionItem[] = ["Chinese", "Korean", "English", "Japanese"].map(
  (title) => ({ id: title, title }),
);

export const TRANSLATION_STATUS_OPTIONS: OptionItem[] = [
  { id: "any", title: "Any" },
  { id: "Active", title: "Active" },
  { id: "Completed", title: "Completed" },
  { id: "Unknown", title: "Unknown" },
  { id: "Break", title: "Break" },
];

export const ORIGINAL_STATUS_OPTIONS: OptionItem[] = [
  { id: "any", title: "Any" },
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Dropped", title: "Dropped" },
];
