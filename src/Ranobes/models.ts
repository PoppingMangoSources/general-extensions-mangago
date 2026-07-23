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
  ALL_TIME: "all-time",
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
  {
    id: SECTIONS.ALL_TIME,
    title: "All Time Popular",
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
    label: "Comments: More → Less",
    sort: "comm_num",
    order: "desc",
  },
  {
    id: "comments_asc",
    label: "Comments: Less → More",
    sort: "comm_num",
    order: "asc",
  },
  { id: "views_desc", label: "Views: Most → Least", sort: "news_read", order: "desc" },
  { id: "views_asc", label: "Views: Least → Most", sort: "news_read", order: "asc" },
  {
    id: "chapters_desc",
    label: "Chapters: More → Less",
    sort: "d.chap-num",
    order: "desc",
  },
  {
    id: "chapters_asc",
    label: "Chapters: Less → More",
    sort: "d.chap-num",
    order: "asc",
  },
  { id: "year_desc", label: "Year: New → Old", sort: "d.year", order: "desc" },
  { id: "year_asc", label: "Year: Old → New", sort: "d.year", order: "asc" },
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

export type PageMetadata = { page: number };
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
  showDate?: string;
  link: string;
}

export interface RanobesChapterPage {
  chapters?: RanobesChapterEntry[];
  pages_count?: number;
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
