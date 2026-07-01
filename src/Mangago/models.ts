/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DiscoverSectionType, type SearchResultItem } from "@paperback/types";

export const DOMAIN = "https://www.mangago.me";

// The reader page needs a desktop UA (+ _m_superu cookie) to return the full image
// list in one request; browsing uses the app's default (mobile) UA, which lists
// chapters as read-manga URLs. See readerHeadersForUrl().
export const READER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

export type MangagoSearchMetadata = {
  page?: number;
  genre?: string;
  genres?: Record<string, "included" | "excluded">;
  statuses?: string[];
  // Default browse sort (genre tiles use "view"); a sort picker overrides it.
  sortby?: string;
};

// Relative update times on /list/latest ("5 minutes", "2 hours", "3 days").
export const RELATIVE_UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

export type MangagoGenreOption = {
  id: string;
  title: string;
};

export const STATUS_OPTIONS = [
  {
    id: "f",
    label: "Completed",
  },
  {
    id: "o",
    label: "Ongoing",
  },
] as const;

export const SORT_OPTIONS = [
  {
    id: "alphabetical",
    label: "Alphabetical",
    value: undefined,
  },
  {
    id: "views",
    label: "Views",
    value: "view",
  },
  {
    id: "popularity",
    label: "Popularity",
    value: "comment_count",
  },
  {
    id: "create_date",
    label: "Create Date",
    value: "create_date",
  },
  {
    id: "update_date",
    label: "Update Date",
    value: "update_date",
  },
] as const;

export const GENRES = [
  "Yaoi",
  "Comedy",
  "Shounen Ai",
  "Shoujo",
  "Yuri",
  "Josei",
  "Fantasy",
  "School Life",
  "Romance",
  "Doujinshi",
  "Smut",
  "Adult",
  "Mystery",
  "One Shot",
  "Ecchi",
  "Shounen",
  "Martial Arts",
  "Shoujo Ai",
  "Supernatural",
  "Drama",
  "Action",
  "Adventure",
  "Harem",
  "Historical",
  "Horror",
  "Mature",
  "Mecha",
  "Psychological",
  "Sci-fi",
  "Seinen",
  "Slice Of Life",
  "Sports",
  "Gender Bender",
  "Tragedy",
  "Bara",
  "Webtoons",
];

export function genreIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const GENRE_OPTIONS: MangagoGenreOption[] = GENRES.map((genre) => ({
  id: genreIdFromTitle(genre),
  title: genre,
}));

export function getGenreTitle(idOrTitle: string): string {
  return (
    GENRE_OPTIONS.find((genre) => genre.id === idOrTitle || genre.title === idOrTitle)?.title ??
    idOrTitle
  );
}

export type MangagoImageContext = {
  desckey: string;
  cols: number;
};

// Detail-page fields that enrich the Featured hero (rating is span.rating_num, 0–10).
export interface FeaturedDetail {
  rating?: string;
  status?: string;
  author?: string;
  summary?: string;
}

// A search/discover tile: a SearchResultItem plus the discover-only extras.
export interface MangagoListing extends SearchResultItem {
  // Reader path of the tile's latest chapter, when present — lets the New
  // Chapters section render as a tappable chapter-updates list.
  chapterId?: string;
  // Update time and genres, only available on the /list/latest/ update page.
  publishDate?: Date;
  genres?: string[];
}

export type DiscoverSectionOption = {
  id: string;
  title: string;
  // Carousel style; the top_* rows alternate featured / simpleCarousel for variety.
  type: DiscoverSectionType;
  // "Top N" rows cap items to N; omitted rows paginate uncapped.
  limit?: number;
};

export const DISCOVER_SECTION_OPTIONS: DiscoverSectionOption[] = [
  { id: "featured_manga", title: "Featured Manga", type: DiscoverSectionType.featured },
  { id: "popular_manga", title: "Popular Manga", type: DiscoverSectionType.prominentCarousel },
  { id: "new_chapters", title: "New Chapters", type: DiscoverSectionType.chapterUpdates },
  { id: "top_yaoi", title: "Yaoi Manga Top 5", type: DiscoverSectionType.featured, limit: 5 },
  {
    id: "top_shoujo",
    title: "Shoujo Manga Top 10",
    type: DiscoverSectionType.simpleCarousel,
    limit: 10,
  },
  { id: "top_comedy", title: "Comedy Manga Top 5", type: DiscoverSectionType.featured, limit: 5 },
  {
    id: "top_supernatural",
    title: "Supernatural Manga Top 10",
    type: DiscoverSectionType.simpleCarousel,
    limit: 10,
  },
  { id: "top_fantasy", title: "Fantasy Manga Top 5", type: DiscoverSectionType.featured, limit: 5 },
  {
    id: "top_mystery",
    title: "Mystery Manga Top 10",
    type: DiscoverSectionType.simpleCarousel,
    limit: 10,
  },
  { id: "top_josei", title: "Josei Manga Top 5", type: DiscoverSectionType.featured, limit: 5 },
  {
    id: "top_shounen_ai",
    title: "Shounen Ai Manga Top 5",
    type: DiscoverSectionType.simpleCarousel,
    limit: 5,
  },
  { id: "top_yuri", title: "Yuri Manga Top 5", type: DiscoverSectionType.featured, limit: 5 },
  {
    id: "top_school_life",
    title: "School Life Manga Top 5",
    type: DiscoverSectionType.simpleCarousel,
    limit: 5,
  },
  { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
];

// Home sections hidden by default until the user enables them.
export const DEFAULT_OFF_SECTION_IDS = new Set<string>([
  "top_shounen_ai",
  "top_yuri",
  "top_school_life",
]);

// Genre tops that add ",Webtoons" so they list only manhwa/manhua.
export const MANHWA_TOP_SECTION_IDS = new Set(["top_supernatural", "top_mystery"]);

// Legacy discover-section ids the app may still send.
export const DISCOVER_SECTION_ALIASES: Record<string, string> = {
  popular: "popular_manga",
  latest: "new_chapters",
};

// The Featured hero enriches this many titles from their detail pages (cached).
export const FEATURED_HERO_LIMIT = 8;

// mangago has no real content-type field; "Webtoons" is its only manhwa/manhua
// signal, so the type filter just includes or excludes that one genre.
export const CONTENT_TYPE_OPTIONS = [
  { id: "all", title: "All" },
  { id: "webtoons", title: "Manhwa / Manhua" },
  { id: "manga", title: "Manga" },
] as const;
