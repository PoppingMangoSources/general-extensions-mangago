/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://toonkotsu.com";

export const PAGE_SIZE = 42;

// The reader's signing secret and the build it shipped with. The key endpoint reports the live
// build, so a mismatch names the cause when the site has rotated the secret.
export const READER_SECRET = "NO57DoQRq7oxY3MCO5_SNw4_3vFRsUq7";
export const READER_BUILD = "1738e5282ffc19e6";

export const STATE_KEYS = {
  CHAPTER_LANGUAGES: "toonkotsu_chapter_languages",
  CONTENT_RATINGS: "toonkotsu_content_ratings",
  TYPES: "toonkotsu_types",
  HIDDEN_TAGS: "toonkotsu_hidden_tags",
  SECTION_ORDER: "toonkotsu_section_order",
  HIDDEN_SECTIONS: "toonkotsu_hidden_sections",
} as const;

export const SECTIONS = {
  MOST_READ: "most-read",
  TRENDING: "trending",
  TOP_RATED: "top-rated",
  HIDDEN_GEMS: "hidden-gems",
  LATEST: "latest",
  RECENTLY_ADDED: "recently-added",
  THIS_SEASON: "this-season",
  COMPLETED: "completed",
  GENRES: "genres",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.MOST_READ]: {
    id: SECTIONS.MOST_READ,
    title: "Most Read",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.TRENDING]: {
    id: SECTIONS.TRENDING,
    title: "Trending",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.TOP_RATED]: {
    id: SECTIONS.TOP_RATED,
    title: "Top Rated",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.HIDDEN_GEMS]: {
    id: SECTIONS.HIDDEN_GEMS,
    title: "Hidden Gems",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.LATEST]: {
    id: SECTIONS.LATEST,
    title: "Latest Updates",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.RECENTLY_ADDED]: {
    id: SECTIONS.RECENTLY_ADDED,
    title: "Recently Added",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.THIS_SEASON]: {
    id: SECTIONS.THIS_SEASON,
    title: "This Season",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.COMPLETED]: {
    id: SECTIONS.COMPLETED,
    title: "Completed",
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

// The site's browse sorts as "<sort>-<order>". Rating, views and follows share the catalogue's
// score and popularity orderings, so each ordering is listed once.
export const SORT_OPTIONS = {
  RELEVANCE: { id: "relevance", label: "Best Match" },
  LATEST: { id: "latest-desc", label: "Latest Upload" },
  OTHERS: [
    { id: "latest-asc", label: "Oldest Upload" },
    { id: "new-desc", label: "Recently Added" },
    { id: "new-asc", label: "Oldest Added" },
    { id: "score-desc", label: "Highest Rated" },
    { id: "score-asc", label: "Lowest Rated" },
    { id: "popular-desc", label: "Most Popular" },
    { id: "popular-asc", label: "Least Popular" },
    { id: "chapters-desc", label: "Most Chapters" },
    { id: "chapters-asc", label: "Fewest Chapters" },
    { id: "year-desc", label: "Newest Year" },
    { id: "year-asc", label: "Oldest Year" },
    { id: "title-asc", label: "Title A-Z" },
    { id: "title-desc", label: "Title Z-A" },
  ],
} as const satisfies Record<string, SortingOption | readonly SortingOption[]>;

export const CHAPTER_LANGUAGE_OPTIONS: Tag[] = [{ id: "en", title: "English" }];

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

export const ORIGINAL_LANGUAGE_OPTIONS: Tag[] = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ja-ro", title: "Japanese (Romanized)" },
  { id: "ko", title: "Korean" },
  { id: "ko-ro", title: "Korean (Romanized)" },
  { id: "zh", title: "Chinese (Simplified)" },
  { id: "zh-hk", title: "Chinese (Traditional)" },
  { id: "zh-ro", title: "Chinese (Romanized)" },
  { id: "xx", title: "Other" },
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
  { id: "all", title: "All" },
  { id: "any", title: "Any" },
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
  "Doujinshi",
]);
export const PORNOGRAPHIC_TAGS = new Set(["Hentai", "Adult", "Smut"]);

// The catalogue files each tag under a category; the main genres have none.
export const TAG_GROUPS = [
  { id: "genres", title: "Genres", prefix: undefined },
  { id: "themes", title: "Themes", prefix: "Theme" },
  { id: "cast", title: "Cast", prefix: "Cast" },
  { id: "setting", title: "Setting", prefix: "Setting" },
  { id: "format", title: "Format", prefix: "Technical" },
] as const;

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

export interface ChapterResponse {
  wrap?: string | null;
  chapter: { pages: ReaderPage[] };
}

export interface ReaderLimit {
  code?: string;
  error?: string;
  reason?: string;
  resign?: boolean;
  transient?: boolean;
  retryAfterSec?: number;
}
