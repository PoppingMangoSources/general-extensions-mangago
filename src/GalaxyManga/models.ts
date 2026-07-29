/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://galaxymanga.io";
export const MANGA_DIR = "manga";

export const NEXT_PAGE_SELECTOR = "div.pagination .next, div.hpage .r, a.next.page-numbers, a.r";

export const STATE_KEYS = {
  SECTION_ORDER: "galaxymanga_section_order",
  VISIBLE_SECTIONS: "galaxymanga_visible_sections",
} as const;

export const SECTIONS = {
  POPULAR: "popular",
  TRENDING: "trending",
  POPULAR_TODAY: "popular-today",
  LATEST: "latest",
  RECOMMENDATION: "recommendation",
  FRESH: "fresh",
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
    title: "Trending Lately",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.POPULAR_TODAY]: {
    id: SECTIONS.POPULAR_TODAY,
    title: "Popular Today",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.LATEST]: {
    id: SECTIONS.LATEST,
    title: "Latest Updates",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.RECOMMENDATION]: {
    id: SECTIONS.RECOMMENDATION,
    title: "Recommendation",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.FRESH]: {
    id: SECTIONS.FRESH,
    title: "Fresh Arrivals",
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

export const TRENDING_RANGES: Tag[] = [
  { id: "wpop-weekly", title: "Weekly" },
  { id: "wpop-monthly", title: "Monthly" },
  { id: "wpop-alltime", title: "All" },
];

export const RECOMMENDED_GENRES: Tag[] = [
  { id: "comedy", title: "Comedy" },
  { id: "romance", title: "Romance" },
  { id: "tragedy", title: "Tragedy" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

export const TYPE_OPTIONS: Tag[] = [
  { id: "", title: "All" },
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "Comic", title: "Comic" },
];

export const SORT_OPTIONS: SortingOption[] = [
  { id: "", label: "Default" },
  { id: "title", label: "A-Z" },
  { id: "titlereverse", label: "Z-A" },
  { id: "update", label: "Latest Update" },
  { id: "latest", label: "Latest Added" },
  { id: "popular", label: "Popular" },
];

// The site labels series by origin type; the featured carousel shows the
// country of origin above the title.
export const TYPE_COUNTRIES: Record<string, string> = {
  manhwa: "Korea",
  manhua: "China",
  manga: "Japan",
};

export type TriState = Record<string, "included" | "excluded">;

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  statuses?: string[];
  types?: string[];
  trendingRange?: string;
}

export interface MangaCard {
  mangaId: string;
  title: string;
  imageUrl: string;
  chapter?: string;
  rating?: string;
  typeName?: string;
  rank?: number;
  genres: string[];
}

export interface LatestCard extends MangaCard {
  chapterId?: string;
  chapterName?: string;
  publishDate?: Date;
}
