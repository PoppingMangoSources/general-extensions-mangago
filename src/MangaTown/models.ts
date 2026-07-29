/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://www.mangatown.com";
export const FEATURED_LIMIT = 10;

export const STATE_KEYS = {
  SECTION_ORDER: "mangatown_section_order",
  VISIBLE_SECTIONS: "mangatown_visible_sections",
} as const;

export const SECTIONS = {
  FEATURED: "featured",
  HOT: "hot",
  LATEST: "latest",
  NEW: "new",
  ROMANCE: "romance",
  SHOUNEN: "shounen",
  TOP_SHOUNEN: "top-shounen",
  SEINEN: "seinen",
  TOP_SEINEN: "top-seinen",
  SHOUJO: "shoujo",
  TOP_SHOUJO: "top-shoujo",
  YAOI: "yaoi",
  SHOUNEN_AI: "shounen-ai",
  JOSEI: "josei",
  TOP_YAOI: "top-yaoi",
  GENRES: "genres",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.FEATURED]: {
    id: SECTIONS.FEATURED,
    title: "Featured Manga",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.HOT]: {
    id: SECTIONS.HOT,
    title: "Hot Manga",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.LATEST]: {
    id: SECTIONS.LATEST,
    title: "Latest Updates",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.NEW]: {
    id: SECTIONS.NEW,
    title: "New Manga Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.ROMANCE]: {
    id: SECTIONS.ROMANCE,
    title: "Romance Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.SHOUNEN]: {
    id: SECTIONS.SHOUNEN,
    title: "Shounen Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.TOP_SHOUNEN]: {
    id: SECTIONS.TOP_SHOUNEN,
    title: "Top Shounen",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.SEINEN]: {
    id: SECTIONS.SEINEN,
    title: "Seinen Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.TOP_SEINEN]: {
    id: SECTIONS.TOP_SEINEN,
    title: "Top Seinen",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.SHOUJO]: {
    id: SECTIONS.SHOUJO,
    title: "Shoujo Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.TOP_SHOUJO]: {
    id: SECTIONS.TOP_SHOUJO,
    title: "Top Shoujo",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.YAOI]: {
    id: SECTIONS.YAOI,
    title: "Yaoi Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.SHOUNEN_AI]: {
    id: SECTIONS.SHOUNEN_AI,
    title: "Shounen Ai Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.JOSEI]: {
    id: SECTIONS.JOSEI,
    title: "Josei Releases",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.TOP_YAOI]: {
    id: SECTIONS.TOP_YAOI,
    title: "Top Yaoi",
    type: DiscoverSectionType.prominentCarousel,
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

export const HOT_PERIODS = [
  { id: "total", title: "Total", token: "" },
  { id: "month", title: "Month", token: "mviews.za" },
  { id: "week", title: "Week", token: "wviews.za" },
  { id: "today", title: "Today", token: "tviews.za" },
] as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "views", label: "Views" },
  { id: "az", label: "A-Z" },
  { id: "rating", label: "Rating" },
  { id: "latest", label: "Latest Updated" },
];

// Bare query keys the site's listing tabs append for each ordering.
export const SORT_TOKENS: Record<string, string> = {
  views: "",
  az: "name.az",
  rating: "rating.za",
  latest: "last_chapter_time.za",
};

export const GENRES: Tag[] = [
  { id: "4_koma", title: "4 Koma" },
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "gender_bender", title: "Gender Bender" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "martial_arts", title: "Martial Arts" },
  { id: "mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "music", title: "Music" },
  { id: "mystery", title: "Mystery" },
  { id: "one_shot", title: "One Shot" },
  { id: "psychological", title: "Psychological" },
  { id: "reverse_harem", title: "Reverse Harem" },
  { id: "romance", title: "Romance" },
  { id: "school_life", title: "School Life" },
  { id: "sci_fi", title: "Sci Fi" },
  { id: "shotacon", title: "Shotacon" },
  { id: "slice_of_life", title: "Slice Of Life" },
  { id: "smut", title: "Smut" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "suspense", title: "Suspense" },
  { id: "tragedy", title: "Tragedy" },
  { id: "vampire", title: "Vampire" },
  { id: "webtoons", title: "Webtoons" },
  { id: "youkai", title: "Youkai" },
];

export const DEMOGRAPHICS: Tag[] = [
  { id: "shounen", title: "Shounen" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shoujo_ai", title: "Shoujo Ai" },
  { id: "josei", title: "Josei" },
  { id: "shounen_ai", title: "Shounen Ai" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
];

export const COMPLETED_OPTIONS: Tag[] = [
  { id: "all", title: "All" },
  { id: "completed", title: "Completed" },
  { id: "ongoing", title: "Ongoing" },
];

export type TriState = Record<string, "included" | "excluded">;

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  demographic?: string[];
  completed?: string[];
  author?: string;
  artist?: string;
  hotPeriod?: string;
}

export interface DirectoryFilters {
  demographic?: string;
  genre?: string;
  status?: string;
  sortToken?: string;
}

export interface SearchRequest {
  name?: string;
  author?: string;
  artist?: string;
  includedGenres?: string[];
  excludedGenres?: string[];
  demographic?: string;
  isCompleted?: string;
}

export interface ListingChapter {
  chapterId: string;
  label: string;
  chapNum?: number;
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
