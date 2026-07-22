/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
} from "@paperback/types";

export const DOMAIN = "https://valirscans.org";

const BASE_URL_KEY = "valirscans.baseUrl";

export const getBaseUrl = (): string => {
  const value = Application.getState(BASE_URL_KEY);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return DOMAIN;
};

export const setBaseUrl = (value: string): void => {
  Application.setState(value.trim().replace(/\/+$/, ""), BASE_URL_KEY);
};

// Genre entries are wrapped as `{ genre: {...} }` in homepage payloads but
// flattened to `{ name, slug }` on series detail pages.
export interface ValirGenre {
  genre?: {
    slug?: string;
    name?: string;
  };
  slug?: string;
  name?: string;
}

export interface ValirChapterItem {
  id: string;
  number: number;
  title?: string | null;
  isLocked?: boolean;
  isFree?: boolean;
  publishedAt?: string | null;
  createdAt?: string | null;
}

export interface ValirSeries {
  slug: string;
  urlSlug?: string;
  title: string;
  type?: string;
  coverImage?: string | null;
  bannerImage?: string | null;
  description?: string | null;
  status?: string | null;
  rating?: number;
  viewCount?: number;
  isMature?: boolean;
  author?: string | null;
  artist?: string | null;
  altTitle?: string | null;
  originalTitle?: string | null;
  aliases?: string[];
  genres?: ValirGenre[];
  tags?: { name?: string; slug?: string }[];
  chapters?: ValirChapterItem[];
  lastChapterAt?: string | null;
}

// Props of the series detail page component: the series record plus a
// paginated chapter list.
export interface ValirSeriesPage {
  series: ValirSeries;
  chapters?: ValirChapterItem[];
  currentPage?: number;
  totalPages?: number;
}

export interface ValirReaderPage {
  pageNumber: number;
  imageUrl: string;
}

export interface ValirChapterData {
  number?: number | string;
  title?: string;
  content?: string | null;
  pages?: ValirReaderPage[];
}

export interface HomeSections {
  featured: ValirSeries[];
  editorsPicks: ValirSeries[];
  latestUpdates: ValirSeries[];
  popularToday: ValirSeries[];
  mostPopular: ValirSeries[];
}

export interface FilterOption {
  id: string;
  title: string;
}

export type PageMetadata = { page: number };

// Selection state consumed by `TriStateSelectRow`: include or exclude per id.
export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  tags?: TriState;
  types?: TriState;
  statuses?: TriState;
  origins?: TriState;
  minChapters?: string;
  maxChapters?: string;
}

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "updated", label: "Recently Updated" },
  { id: "popular", label: "Most Bookmarked" },
  { id: "views", label: "Most Viewed" },
  { id: "longest", label: "Longest" },
  { id: "trending", label: "Trending" },
  { id: "rating", label: "Top Rated" },
  { id: "newest", label: "Newest" },
];

// Option ids are the exact values the site's browse URL accepts
// (e.g. ?type=Manhwa, ?status=Ongoing, ?origin=KOREAN).
export const TYPE_OPTIONS: FilterOption[] = [
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "Manga", title: "Manga" },
  { id: "Comic", title: "Comic" },
  { id: "Webtoon", title: "Webtoon" },
  { id: "Novel", title: "Novel" },
];

export const STATUS_OPTIONS: FilterOption[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Completed", title: "Completed" },
  { id: "Hiatus", title: "Hiatus" },
  { id: "Cancelled", title: "Cancelled" },
];

export const ORIGIN_OPTIONS: FilterOption[] = [
  { id: "KOREAN", title: "Korean" },
  { id: "JAPANESE", title: "Japanese" },
  { id: "CHINESE", title: "Chinese" },
  { id: "ENGLISH", title: "English" },
];

// Bundled fallback for the genre filter; the live taxonomy (genres + the
// larger tag set) is fetched from the browse page and cached per session.
export const GENRES: FilterOption[] = [
  { id: "action", title: "Action" },
  { id: "adult", title: "Adult" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "gamelit", title: "GameLit" },
  { id: "gender-bender", title: "Gender Bender" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "isekai", title: "Isekai" },
  { id: "josei", title: "Josei" },
  { id: "litrpg", title: "LitRPG" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "military", title: "Military" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shoujo-ai", title: "Shoujo Ai" },
  { id: "shounen", title: "Shounen" },
  { id: "shounen-ai", title: "Shounen Ai" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "smut", title: "Smut" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "thriller", title: "Thriller" },
  { id: "tragedy", title: "Tragedy" },
  { id: "virtual-reality", title: "Virtual Reality" },
  { id: "wuxia", title: "Wuxia" },
  { id: "xianxia", title: "Xianxia" },
  { id: "xuanhuan", title: "Xuanhuan" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
];

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "featured", title: "Top Featured", type: DiscoverSectionType.featured },
  { id: "editors-picks", title: "Editors' Picks", type: DiscoverSectionType.prominentCarousel },
  { id: "latest-comics", title: "Latest Comic Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "latest-novels", title: "Latest Novel Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "popular-today", title: "Popular Today", type: DiscoverSectionType.prominentCarousel },
  { id: "most-popular", title: "Most Popular", type: DiscoverSectionType.simpleCarousel },
  { id: "new-series", title: "New Series", type: DiscoverSectionType.simpleCarousel },
];
