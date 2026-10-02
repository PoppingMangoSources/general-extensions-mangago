/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://yaoi.me";

export const STATE_KEYS = {
  CHAPTER_LANGUAGES: "yaoime_chapter_languages",
  CONTENT_RATINGS: "yaoime_content_ratings",
  CONTENT_TYPES: "yaoime_content_types",
  HIDDEN_TAGS: "yaoime_hidden_tags",
  OFFICIAL_ONLY: "yaoime_official_only",
  SECTION_ORDER: "yaoime_section_order",
  VISIBLE_SECTIONS: "yaoime_visible_sections",
} as const;

export const SECTIONS = {
  POPULAR: "popular",
  BINGE: "binge",
  TRENDING: "trending",
  TOP_RATED: "top-rated",
  LATEST: "latest",
  BOOKMARKED: "bookmarked",
  HIDDEN_GEMS: "hidden-gems",
  TALKED: "talked",
  RISING: "rising",
  GENRES: "genres",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.POPULAR]: {
    id: SECTIONS.POPULAR,
    title: "Popular Updates",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.BINGE]: {
    id: SECTIONS.BINGE,
    title: "Binge Worthy",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.TRENDING]: {
    id: SECTIONS.TRENDING,
    title: "Trending Now",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.TOP_RATED]: {
    id: SECTIONS.TOP_RATED,
    title: "Top Rated",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.LATEST]: {
    id: SECTIONS.LATEST,
    title: "Latest Releases",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.BOOKMARKED]: {
    id: SECTIONS.BOOKMARKED,
    title: "Most Bookmarked",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.HIDDEN_GEMS]: {
    id: SECTIONS.HIDDEN_GEMS,
    title: "Hidden Gems",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.TALKED]: {
    id: SECTIONS.TALKED,
    title: "Most Talked About",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.RISING]: {
    id: SECTIONS.RISING,
    title: "Rising",
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

export const TYPE_OPTIONS: Tag[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "oel", title: "OEL" },
  { id: "novel", title: "Novel" },
  { id: "other", title: "Other" },
];

export const CONTENT_RATING_OPTIONS: Tag[] = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

export const DEMOGRAPHIC_OPTIONS: Tag[] = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
];

export const LANGUAGE_OPTIONS: Tag[] = [
  ["en", "English"],
  ["es", "Spanish"],
  ["vi", "Vietnamese"],
  ["fr", "French"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["id", "Indonesian"],
  ["th", "Thai"],
  ["ko", "Korean"],
  ["ja", "Japanese"],
  ["zh", "Chinese"],
  ["de", "German"],
  ["it", "Italian"],
  ["pl", "Polish"],
  ["tr", "Turkish"],
  ["ar", "Arabic"],
  ["nl", "Dutch"],
  ["hu", "Hungarian"],
  ["cs", "Czech"],
  ["ro", "Romanian"],
  ["fi", "Finnish"],
  ["ms", "Malay"],
  ["mn", "Mongolian"],
  ["uk", "Ukrainian"],
  ["fa", "Persian"],
  ["he", "Hebrew"],
  ["bg", "Bulgarian"],
  ["bn", "Bengali"],
  ["sr", "Serbian"],
  ["hi", "Hindi"],
  ["my", "Burmese"],
  ["sk", "Slovak"],
  ["kk", "Kazakh"],
  ["hr", "Croatian"],
  ["km", "Khmer"],
  ["ca", "Catalan"],
  ["el", "Greek"],
  ["sv", "Swedish"],
  ["no", "Norwegian"],
  ["da", "Danish"],
  ["lt", "Lithuanian"],
  ["lv", "Latvian"],
  ["et", "Estonian"],
  ["sl", "Slovenian"],
  ["bs", "Bosnian"],
  ["mk", "Macedonian"],
  ["sq", "Albanian"],
  ["ka", "Georgian"],
  ["hy", "Armenian"],
  ["az", "Azerbaijani"],
  ["uz", "Uzbek"],
  ["ne", "Nepali"],
  ["lo", "Lao"],
  ["tl", "Tagalog"],
  ["af", "Afrikaans"],
  ["sw", "Swahili"],
  ["is", "Icelandic"],
  ["pt-br", "Portuguese (BR)"],
  ["pt-pt", "Portuguese (PT)"],
  ["es-419", "Spanish (LATAM)"],
  ["zh-hk", "Chinese (HK)"],
  ["zh-tw", "Chinese (TW)"],
  ["zh-hans", "Chinese (Simplified)"],
  ["zh-hant", "Chinese (Traditional)"],
  ["en-us", "English (US)"],
  ["en-gb", "English (UK)"],
].map(([id, title]) => ({ id, title }));

export const DEFAULT_LANGUAGES = ["en"];
export const DEFAULT_TYPES = TYPE_OPTIONS.map(({ id }) => id);
export const DEFAULT_RATINGS = CONTENT_RATING_OPTIONS.map(({ id }) => id);

export const SORT_OPTIONS: SortingOption[] = [
  { id: "update-desc", label: "Recently Updated" },
  { id: "create-desc", label: "Recently Added" },
  { id: "popular-desc", label: "Most Popular" },
  { id: "rating-desc", label: "Highest Rated" },
  { id: "chapters-desc", label: "Most Chapters" },
  { id: "az-asc", label: "Title A–Z" },
  { id: "az-desc", label: "Title Z–A" },
];

export interface Preferences {
  chapterLanguages: string[];
  contentRatings: string[];
  contentTypes: string[];
  hiddenTags: string[];
  officialOnly: boolean;
}

export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  anime?: boolean;
  artist?: string;
  author?: string;
  demographics?: string[];
  genres?: TriState;
  languages?: string[];
  licensed?: boolean;
  minChapters?: string;
  maxChapters?: string;
  minPages?: string;
  minRating?: string;
  maxRating?: string;
  publisher?: string;
  ratings?: string[];
  statuses?: string[];
  tags?: TriState;
  types?: string[];
  updatedWithin?: string;
  yearFrom?: string;
  yearTo?: string;
}

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface MangaCard {
  mangaId: string;
  title: string;
  imageUrl: string;
  status?: string;
  typeName?: string;
  rating?: string;
  chapter?: string;
  chapterId?: string;
  publishDate?: Date;
  contentRating: "safe" | "suggestive" | "erotica" | "pornographic";
}
