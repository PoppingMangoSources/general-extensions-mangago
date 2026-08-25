/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://www.mvlempyr.io";
export const CHAPTER_API = "https://chap.heliosarchive.online";
export const ASSETS_URL = "https://assets.mvlempyr.app";

export const PAGE_SIZE = 20;
export const CATALOGUE_PAGE_SIZE = 1000;
export const CHAPTER_PAGE_SIZE = 500;
export const LATEST_PAGE_SIZE = 30;

export const STATE_KEYS = {
  SECTION_ORDER: "mvlempyr_section_order",
  VISIBLE_SECTIONS: "mvlempyr_visible_sections",
} as const;

export const NOVEL_CODE_KEY_PREFIX = "mvlempyr_code_";

export const SECTIONS = {
  POPULAR: "popular",
  TRENDING: "trending",
  RECOMMENDED: "recommended",
  TOP_RATED: "top-rated",
  NEW_UPDATES: "new-updates",
  COMPLETED: "completed",
  NEW_ARRIVALS: "new-arrivals",
  MOST_REVIEWED: "most-reviewed",
  ROMANCE: "romance",
  GENRES: "genres",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.POPULAR]: {
    id: SECTIONS.POPULAR,
    title: "Popular",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.TRENDING]: {
    id: SECTIONS.TRENDING,
    title: "Trending",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.RECOMMENDED]: {
    id: SECTIONS.RECOMMENDED,
    title: "Recommended",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.TOP_RATED]: {
    id: SECTIONS.TOP_RATED,
    title: "Top Rated",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.NEW_UPDATES]: {
    id: SECTIONS.NEW_UPDATES,
    title: "New Updates",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.COMPLETED]: {
    id: SECTIONS.COMPLETED,
    title: "Completed",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.NEW_ARRIVALS]: {
    id: SECTIONS.NEW_ARRIVALS,
    title: "New Arrivals",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.MOST_REVIEWED]: {
    id: SECTIONS.MOST_REVIEWED,
    title: "Most Reviewed",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.ROMANCE]: {
    id: SECTIONS.ROMANCE,
    title: "Romance",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.GENRES]: {
    id: SECTIONS.GENRES,
    title: "Genres",
    type: DiscoverSectionType.genres,
  },
};

export const SECTION_OPTIONS: Tag[] = Object.values(SECTION_DEFINITIONS).map((section) => ({
  id: section.id,
  title: section.title,
}));

// Class names of the server-rendered homepage widgets each section reads.
export const HOME_SECTION_CLASSES = {
  POPULAR: "popular-section",
  TRENDING: "trending-section",
  RECOMMENDED: "recommended-section",
  COMPLETED: "completed-section",
  ROMANCE: "romance-section",
} as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "reviews", label: "Most Reviewed" },
  { id: "rating", label: "Average Rating" },
  { id: "new", label: "Latest Added" },
  { id: "chapters", label: "Chapters Desc" },
  { id: "chapters-asc", label: "Chapters Asc" },
  { id: "az", label: "Name (A-Z)" },
  { id: "za", label: "Name (Z-A)" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "all", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

export const GENRE_MATCH_OPTIONS: Tag[] = [
  { id: "and", title: "AND" },
  { id: "or", title: "OR" },
];

export const GENRES: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adult", title: "Adult" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fan-fiction", title: "Fan-Fiction" },
  { id: "fantasy", title: "Fantasy" },
  { id: "gender-bender", title: "Gender Bender" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "josei", title: "Josei" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shoujo-ai", title: "Shoujo Ai" },
  { id: "shounen", title: "Shounen" },
  { id: "shounen-ai", title: "Shounen Ai" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "smut", title: "Smut" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "tragedy", title: "Tragedy" },
  { id: "wuxia", title: "Wuxia" },
  { id: "xianxia", title: "Xianxia" },
  { id: "xuanhuan", title: "Xuanhuan" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
];

export type TriState = Record<string, "included" | "excluded">;

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  genreMatch?: string[];
  statuses?: string[];
  author?: string;
  minChapters?: string;
  maxChapters?: string;
}

// One record of the site's full novel catalogue API.
export interface CatalogueNovelResponse {
  name?: string;
  slug?: string;
  "novel-code"?: number | string;
  "average-review"?: number | string;
  "total-reviews"?: number | string;
  "total-chapters"?: number | string;
  createdOn?: string;
  genre?: string[];
  tags?: string[];
  "author-name"?: string;
  status?: string;
}

export interface CatalogueNovel {
  name: string;
  slug: string;
  code: number;
  rating?: number;
  reviews?: number;
  chapters?: number;
  created?: number;
  genres: string[];
  author?: string;
  status?: string;
}

// One chapter post from the site's WordPress posts API.
export interface ChapterPostResponse {
  date?: string;
  acf?: {
    ch_name?: string;
    chapter_number?: number | string;
    novel_code?: number | string;
  };
}

export interface HomeCard {
  slug: string;
  title: string;
  imageUrl: string;
  rating?: string;
  status?: string;
  chapter?: string;
}
