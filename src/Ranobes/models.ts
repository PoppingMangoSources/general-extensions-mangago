/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
} from "@paperback/types";

export const DOMAIN = "https://ranobes.net";
export const PAGE_SIZE = 20;

export const SECTION_FEATURED = "featured";
export const SECTION_LATEST = "latest";
export const SECTION_MOST_VIEWED = "most-viewed";
export const SECTION_MOST_RATED = "most-rated";
export const SECTION_ALL_TIME = "all-time";

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: SECTION_FEATURED, title: "Featured", type: DiscoverSectionType.featured },
  { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  {
    id: SECTION_MOST_VIEWED,
    title: "Most Viewed Novels",
    type: DiscoverSectionType.prominentCarousel,
  },
  {
    id: SECTION_MOST_RATED,
    title: "Most Rated Novels",
    type: DiscoverSectionType.prominentCarousel,
  },
  { id: SECTION_ALL_TIME, title: "All Time Popular", type: DiscoverSectionType.prominentCarousel },
];

export type PageMetadata = { page: number };

export interface SearchMetadata extends JSONObject {
  genres?: Record<string, "included" | "excluded">;
  events?: Record<string, "included" | "excluded">;
  languages?: Record<string, "included" | "excluded">;
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

export interface RanobesCard {
  mangaId: string;
  title: string;
  imageUrl: string;
  description?: string;
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

export const LANGUAGE_OPTIONS: OptionItem[] = ["Chinese", "English", "Japanese", "Korean"].map(
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

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "default", label: "Default" },
  { id: "rating", label: "Rating" },
  { id: "title_asc", label: "Title (ASC)" },
  { id: "date_desc", label: "New Novels (DESC)" },
  { id: "date_asc", label: "Old Novels (ASC)" },
  { id: "comments_desc", label: "Comments: More → Less" },
  { id: "comments_asc", label: "Comments: Less → More" },
  { id: "views_desc", label: "Views: Most → Least" },
  { id: "views_asc", label: "Views: Least → Most" },
  { id: "chapters_desc", label: "Chapters: More → Less" },
  { id: "chapters_asc", label: "Chapters: Less → More" },
  { id: "year_desc", label: "Year: New → Old" },
  { id: "year_asc", label: "Year: Old → New" },
  { id: "modified_desc", label: "Recently Modified" },
];

export const VOID_TAGS = "area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr";
