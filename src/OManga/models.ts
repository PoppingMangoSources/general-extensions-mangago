/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject } from "@paperback/types";

export const DEFAULT_DOMAIN = "https://omanga.to";
export const FEATURED_HERO_LIMIT = 17;

export const SECTIONS = {
  POPULAR: "popular",
  TREND: "trend",
  POPULAR_TODAY: "popular_today",
  UPDATES: "updates",
  TOP_SERIES: "top_series",
  NEW_SEASON: "new_season",
  MOST_LIKED: "most_liked",
  BEST_ONGOING: "best_ongoing",
  GENRES: "genres",
} as const;

export type CatalogQuery = Record<string, string | string[] | undefined>;

export interface CatalogResponse {
  items: CatalogItem[];
  hasMore: boolean;
  nextPage?: number | null;
}

const BASE_URL_KEY = "omanga_base_url";
const ALL_VERSIONS_KEY = "omanga_all_versions";

export const getDomain = (): string => {
  const value = Application.getState(BASE_URL_KEY);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return DEFAULT_DOMAIN;
};

export const setDomainOverride = (value: string): void => {
  Application.setState(value, BASE_URL_KEY);
};

const OFFICIAL_TEAMS = new Set([
  "official",
  "tapas",
  "webtoon",
  "manta",
  "tappytoon",
  "mangaplus",
  "kodansha",
  "coolmic",
  "omoi",
  "kmanga",
  "toomics",
  "pocketcomics",
  "shonenjump",
  "vizmanga",
  "vizmedia",
  "yenpress",
  "webcomic",
  "webcomics",
  "webcomicsapp",
  "mangaup",
  "inkrcomics",
  "thehoursbetween",
  "jujucat",
  "akumakira",
  "comikey",
  "lezhin",
  "lehzin",
]);

const normalizeTeamKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export const isOfficialTeam = (name?: string | null, slug?: string | null): boolean =>
  [name, slug].some(
    (value) => typeof value === "string" && OFFICIAL_TEAMS.has(normalizeTeamKey(value)),
  );

export const getShowAllVersions = (): boolean =>
  (Application.getState(ALL_VERSIONS_KEY) as boolean | undefined) ?? true;

export const setShowAllVersions = (value: boolean): void => {
  Application.setState(value, ALL_VERSIONS_KEY);
};
export interface CatalogItem {
  id: number;
  title: string;
  slug: string;
  poster: string;
  type?: string; // "Manga", "Manhwa", "Manhua", …
  genres?: string[];
  rating?: number;
  views?: number;
  votes?: number;
  year?: number; // homepage rows only
  _count?: { chapters?: number };
}
export interface ChapterEntry {
  id: number;
  mangaId: number;
  number: number;
  volume?: number | null;
  title?: string | null;
  createdAt?: string | null; // "$D2026-07-14T02:23:00.772Z"
  translator?: string | null;
  isLocked?: boolean;
  team?: { id?: number; name?: string; slug?: string } | null;
}
export interface SeriesProps {
  mangaId: number;
  slug: string;
  title: string;
  description?: string;
  genres?: string[];
  tags?: string[];
  publisher?: string;
  author?: string;
  artist?: string;
  translator?: string;
  status?: string; // "Ongoing", "Completed", "Hiatus", "Cancelled", "Announced"
  ageRating?: string; // "For all", "12+", "15+", "16+", "18+", "21+"
  altNames?: string[];
  chapters?: ChapterEntry[];
}
export interface ReaderChapter {
  id: number;
  number: number;
  title?: string | null;
  volume?: number | null;
  pages?: string[];
  pagesAlt?: string[];
  translator?: string | null;
  team?: { name?: string; slug?: string } | null;
}
export interface PageMetadata extends JSONObject {
  page: number;
}
export type TopSeriesCountry = "korea" | "japan" | "china";
export type SearchMetadata = {
  genres?: string[];
  excludeGenres?: string[];
  genreStrict?: boolean;
  types?: string[];
  excludeTypes?: string[];
  statuses?: string[];
  ageRatings?: string[];
  minRating?: string;
  years?: string[];
  chaptersFrom?: string;
  chaptersTo?: string;
  tag?: string;
  sort?: string;
  topSeriesCountry?: TopSeriesCountry;
};

export type OptionItem = {
  id: string;
  value: string;
};

const toOptionId = (value: string): string => value.replace(/\s+/g, "_");

const toOptions = (values: string[]): OptionItem[] =>
  values.map((value) => ({ id: toOptionId(value), value }));
export const resolveOptionValues = (
  options: OptionItem[],
  ids?: string[],
): string[] | undefined => {
  if (!ids || ids.length === 0) return undefined;
  return ids.map((id) => options.find((option) => option.id === id)?.value ?? id);
};

export const GENRE_OPTIONS: OptionItem[] = toOptions([
  "Action",
  "Adult",
  "Adventure",
  "Comedy",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Gender Bender",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Josei",
  "Lolicon",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-fi",
  "Seinen",
  "Shotacon",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "Tragedy",
  "Yaoi",
  "Yuri",
]);

export const TYPE_OPTIONS: OptionItem[] = toOptions([
  "Manga",
  "Manhwa",
  "Manhua",
  "One-shot",
  "Doujinshi",
  "Novel",
  "Comics",
  "Other",
]);

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "Ongoing", value: "Ongoing" },
  { id: "Completed", value: "Completed" },
  { id: "Hiatus", value: "On Hiatus" },
  { id: "Cancelled", value: "Axed" },
  { id: "Announced", value: "Preview" },
];

export const AGE_RATING_OPTIONS: OptionItem[] = toOptions([
  "For all",
  "12+",
  "15+",
  "16+",
  "18+",
  "21+",
]);

export const MIN_RATING_OPTIONS: OptionItem[] = [
  { id: "5", value: "5+ (Average)" },
  { id: "6", value: "6+ (Good)" },
  { id: "7", value: "7+ (Very Good)" },
  { id: "8", value: "8+ (Excellent)" },
  { id: "9", value: "9+ (Masterpiece)" },
];

const currentYear = new Date().getFullYear();

export const YEAR_OPTIONS: OptionItem[] = Array.from(
  { length: currentYear - 1950 + 1 },
  (_, index) => {
    const year = String(currentYear - index);
    return { id: year, value: year };
  },
);
export const SORT_OPTIONS = [
  { id: "real_views", label: "Popularity" },
  { id: "updated_at", label: "Recently Updated" },
  { id: "created_at", label: "Newest" },
  { id: "rating", label: "Rating" },
  { id: "votes", label: "Votes" },
  { id: "likes", label: "Likes" },
  { id: "chapters", label: "Chapter Count" },
  { id: "by_views", label: "Views" },
] as const;
export const TOP_SERIES_CHIPS = [
  { title: "From Korea", country: "korea", type: "Manhwa" },
  { title: "From Japan", country: "japan", type: "Manga" },
  { title: "From China", country: "china", type: "Manhua" },
] as const;
export interface HomeUpdate {
  id: number;
  number: number;
  volume?: number | null;
  createdAt?: string | null;
  manga?: {
    id: number;
    title: string;
    slug: string;
    type?: string;
    poster?: string;
  };
}

export interface HomeLinkCard {
  slug: string;
  title: string;
  cover: string;
  type?: string;
  year?: string;
}
