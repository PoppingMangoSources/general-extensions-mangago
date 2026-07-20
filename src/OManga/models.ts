/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject } from "@paperback/types";

export const DEFAULT_DOMAIN = "https://omanga.to";

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

// Official publisher/platform teams get a star in the chapter list, matched
// on the team name/slug with spacing and punctuation ignored.
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
  "webcomics",
  "mangaup",
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

/** Series card as embedded in catalog pages and homepage rows. */
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

/** One chapter row in the series payload's `chapters` array. */
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

/** Series payload embedded in `/manga/<slug>` pages. */
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

/** Chapter payload embedded in `/manga/<slug>/chapter/<number>` pages. */
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

/** Pagination cursor for Paperback's PagedResults. */
export interface PageMetadata extends JSONObject {
  page: number;
  // First item id of the previous page — detects a server that ignored `page`
  // and echoed the same list, so pagination stops instead of looping.
  firstId?: number;
}

/** Advanced-search selections carried through SearchQuery.metadata (option ids). */
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
  // Default catalog sort for queries launched from discover chips; an explicit
  // pick in the sort menu still wins.
  sort?: string;
};

export type OptionItem = {
  id: string;
  value: string;
};

// The app rejects option ids containing spaces, so ids are the display value
// with spaces collapsed to underscores; `resolveOptionValues` maps them back to the
// exact strings the catalog expects.
const toOptionId = (value: string): string => value.replace(/\s+/g, "_");

const toOptions = (values: string[]): OptionItem[] =>
  values.map((value) => ({ id: toOptionId(value), value }));

/** Resolve selected option ids back to their site-facing values. */
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

// Ids are the catalog's stored values; labels match the site's filter drawer.
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

// Minimum community score, as the site's Rating filter offers it.
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

/** Catalog sort keys, in the order the sort picker offers them. */
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

/** "Top Series" chips — the site's country tabs, mapped to type filters. */
export const TOP_SERIES_CHIPS = [
  { title: "From Korea", type: "Manhwa" },
  { title: "From Japan", type: "Manga" },
  { title: "From China", type: "Manhua" },
] as const;

/** One row of the homepage Updates feed. */
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
