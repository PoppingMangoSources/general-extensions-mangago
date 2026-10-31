/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://toonkotsu.com";

export const PAGE_SIZE = 42;
export const SERIES_CACHE_TTL_MS = 30_000;

// The reader's signing secret and the build it shipped with. The key endpoint reports the live
// build, so a mismatch names the cause when the site has rotated the secret.
export const READER_SECRET = "NO57DoQRq7oxY3MCO5_SNw4_3vFRsUq7";
export const READER_BUILD = "1738e5282ffc19e6";

export const STATE_KEYS = {
  CONTENT_RATINGS: "toonkotsu_content_ratings",
  TYPES: "toonkotsu_types",
  HIDDEN_TAGS: "toonkotsu_hidden_tags",
  SECTION_ORDER: "toonkotsu_section_order",
  HIDDEN_SECTIONS: "toonkotsu_hidden_sections",
  DEDUPLICATE_CHAPTERS: "toonkotsu_deduplicate_chapters",
  SHOW_UPLOAD_SIZE: "toonkotsu_show_upload_size",
  SMALLEST_UPLOAD: "toonkotsu_smallest_upload",
  HIDDEN_GROUPS: "toonkotsu_hidden_groups",
  SERIES_GENERATION: "toonkotsu_series_generation",
} as const;

export const SECTIONS = {
  MOST_READ: "most-read",
  TRENDING: "trending",
  RECENTLY_ADDED: "recently-added",
  HIDDEN_GEMS: "hidden-gems",
  LATEST: "latest",
  THIS_SEASON: "this-season",
  COMPLETED: "completed",
  GENRES: "genres",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.MOST_READ]: {
    id: SECTIONS.MOST_READ,
    title: "Most Read",
    subtitle: "The titles readers open most",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.TRENDING]: {
    id: SECTIONS.TRENDING,
    title: "Trending",
    subtitle: "What is gaining momentum with readers",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.RECENTLY_ADDED]: {
    id: SECTIONS.RECENTLY_ADDED,
    title: "Recently Added",
    subtitle: "New arrivals in the catalogue",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.HIDDEN_GEMS]: {
    id: SECTIONS.HIDDEN_GEMS,
    title: "Hidden Gems",
    subtitle: "Highly rated finds with fewer readers",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.LATEST]: {
    id: SECTIONS.LATEST,
    title: "Latest Updates",
    subtitle: "Fresh chapter uploads as they arrive",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.THIS_SEASON]: {
    id: SECTIONS.THIS_SEASON,
    title: "This Season",
    subtitle: "The catalogue's seasonal picks",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.COMPLETED]: {
    id: SECTIONS.COMPLETED,
    title: "Completed",
    subtitle: "Finished stories to read from start to end",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.GENRES]: {
    id: SECTIONS.GENRES,
    title: "Genres",
    type: DiscoverSectionType.genres,
  },
};

export const SECTION_IDS = Object.values(SECTIONS);
export const SECTION_OPTIONS: Tag[] = SECTION_IDS.map((id) => ({
  id,
  title: SECTION_DEFINITIONS[id].title,
}));

// Paperback defaults to the first option. The site aliases Updated/Uploaded and View/Follow.
export const SORT_OPTIONS = [
  { id: "relevance", label: "Best Match", value: "relevance" },
  { id: "createdAt", label: "Created Date", value: "new" },
  { id: "updatedAt", label: "Updated Date", value: "latest" },
  { id: "lastUploadedChapterAt", label: "Uploaded Date", value: "latest" },
  { id: "title", label: "Title", value: "title" },
  { id: "year", label: "Year", value: "year" },
  { id: "rating", label: "Rating", value: "score" },
  { id: "views", label: "View Count", value: "popular" },
  { id: "follows", label: "Follow Count", value: "popular" },
  { id: "chapters", label: "Chapter Count", value: "chapters" },
] as const;

// Default follows the site: a title list starts at A, every other sort newest or highest first.
export const ORDER_OPTIONS: Tag[] = [
  { id: "default", title: "Default" },
  { id: "desc", title: "Descending" },
  { id: "asc", title: "Ascending" },
];

export const CONTENT_RATING_OPTIONS: Tag[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const DEFAULT_CONTENT_RATINGS = ["safe", "suggestive", "erotica"];

// The catalogue files a series by its original language; these are the types that language makes.
export const TYPE_OPTIONS = [
  { id: "manga", title: "Manga", languages: ["ja", "ja-ro"] },
  { id: "manhwa", title: "Manhwa", languages: ["ko", "ko-ro"] },
  { id: "manhua", title: "Manhua", languages: ["zh", "zh-hk", "zh-ro"] },
  { id: "oel", title: "OEL", languages: ["en"] },
  { id: "other", title: "Other", languages: ["xx"] },
];

export const COUNTRY_OPTIONS: Tag[] = [
  { id: "ja", title: "Japan" },
  { id: "ko", title: "Korea" },
  { id: "zh", title: "China" },
  { id: "en", title: "Western" },
];

export const DEMOGRAPHIC_OPTIONS: Tag[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "none", title: "None" },
];

export const STATUS_OPTIONS = [
  { id: "ongoing", title: "Ongoing", value: "Ongoing" },
  { id: "completed", title: "Completed", value: "Complete" },
  { id: "hiatus", title: "Hiatus", value: "Hiatus" },
  { id: "cancelled", title: "Cancelled", value: "Canceled" },
] satisfies (Tag & { value: string })[];

export const MATCH_MODE_OPTIONS: Tag[] = [
  { id: "all", title: "AND" },
  { id: "any", title: "OR" },
];

// Tags the site keeps out of its genre list: demographics have their own filter, and these are
// never offered for browsing.
export const UNLISTED_TAGS = new Set([
  "Shounen",
  "Shoujo",
  "Seinen",
  "Josei",
  "Lolicon",
  "Shotacon",
  "Other",
]);
export const PORNOGRAPHIC_TAGS = new Set(["Hentai", "Adult", "Smut"]);

// The site's tag picker: anything the catalogue files under a category reads as a theme there, as
// do a few uncategorised names, and only the adult tags and Doujinshi stand apart from the genres.
export const TAG_GROUPS = [
  { id: "content", title: "Content" },
  { id: "format", title: "Format" },
  { id: "genres", title: "Genre" },
  { id: "themes", title: "Theme" },
] as const;
export const CONTENT_TAGS = new Set(["Ecchi", "Mature", "Smut", "Adult", "Hentai"]);
export const FORMAT_TAGS = new Set(["Doujinshi"]);
export const THEME_TAGS = new Set([
  "School Life",
  "Martial Arts",
  "Harem",
  "Isekai",
  "Gender Bender",
  "Mecha",
  "Supernatural",
  "Historical",
]);

export const STATUS_NAMES: Record<string, string> = {
  Complete: "Completed",
  Canceled: "Cancelled",
};

export type ContentRatingId = "safe" | "suggestive" | "erotica" | "pornographic";
export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  genreMode?: string;
  excludeMode?: string;
  demographics?: string[];
  statuses?: string[];
  languages?: string[];
  ratings?: string[];
  author?: string;
  yearFrom?: string;
  yearTo?: string;
  chaptersMin?: string;
  chaptersMax?: string;
  order?: string;
  hasChapters?: boolean;
}

export interface PageMetadata extends JSONObject {
  page: number;
  // Titles already shown in Latest Updates, so a later page does not repeat them.
  seen?: number[];
}

export interface CatalogueFilters {
  sfw: boolean;
  exclude: string[];
  originalLanguage: string[];
}

export interface LatestChapterRef {
  id?: number;
  label?: string | null;
  n?: number | null;
  at?: number | null;
}

export interface Series {
  id: number;
  hid?: string | null;
  slug?: string | null;
  title: string;
  titles?: { english?: string | null; romaji?: string | null; native?: string | null } | null;
  alt?: string[] | null;
  description?: string | null;
  year?: number | null;
  type?: string | null;
  tags?: string[] | null;
  spoilerTags?: string[] | null;
  status?: string | null;
  cover?: string | null;
  banner?: string | null;
  hero?: string | null;
  score?: number | null;
  latest?: LatestChapterRef | null;
  chapters?: number | null;
  authors?: string[] | null;
  adult?: boolean | null;
  // Chapter opens, on reading rankings.
  count?: number | null;
}

export interface ChapterGroup {
  slug?: string | null;
  name?: string | null;
}

export interface ChapterRelease {
  id: number;
  label?: string | null;
  at?: number | null;
  src?: string | null;
  group?: ChapterGroup | null;
  partial?: boolean | null;
  // Page width in pixels and download size in megabytes, which rank a group's uploads.
  w?: number | null;
  mb?: number | null;
}

export interface ChapterEntry extends ChapterRelease {
  n?: number | null;
  vol?: string | number | null;
  alts?: ChapterRelease[] | null;
}

export interface SeriesListResponse {
  items: Series[];
  page?: number;
  limit?: number;
  total?: number;
  hasNextPage?: boolean;
}

export interface LatestResponse {
  items: { chapter: ChapterEntry; series: Series }[];
  page?: number;
  hasNextPage?: boolean;
}

export interface SeriesResponse {
  series: Series;
  chapters: ChapterEntry[];
}

export interface CachedSeries {
  mangaId: string;
  generation: number;
  expiresAt: number;
  response: SeriesResponse;
}

export interface Facet {
  name: string;
  category?: string | null;
  isAdult?: boolean | null;
}

export interface FacetsResponse {
  genres?: Facet[];
}

export interface ReaderKeyResponse {
  key: string;
  build: string;
  now: number;
}

export interface ReaderPage {
  src: string;
  k?: string | null;
  n?: string | null;
}

export interface ReaderLimit {
  code?: string;
  error?: string;
  reason?: string;
  resign?: boolean;
  transient?: boolean;
  retryAfterSec?: number;
}
