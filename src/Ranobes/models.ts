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
  language?: string;
  status?: string;
  author?: string;
  translator?: string;
}

export type OptionItem = { id: string; title: string };

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

export const GENRE_OPTIONS: OptionItem[] = [
  "Action",
  "Adventure",
  "Adult",
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
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Smut",
  "Tragedy",
  "Wuxia",
  "Xianxia",
  "Xuanhuan",
  "Yaoi",
].map((value) => ({ id: value, title: value }));

export const LANGUAGE_OPTIONS: OptionItem[] = ["Chinese", "English", "Japanese", "Korean"].map(
  (value) => ({ id: value, title: value }),
);

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
];

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "views", label: "Most Viewed" },
  { id: "rating", label: "Rating" },
  { id: "date", label: "Newest" },
  { id: "date-asc", label: "Oldest" },
];
