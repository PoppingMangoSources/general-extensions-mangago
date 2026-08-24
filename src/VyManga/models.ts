/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type JSONObject, type Tag } from "@paperback/types";

export const DEFAULT_DOMAIN = "https://mangavyvy.net";
export const SEARCH_PATH = "search";
export const GENRES_KEY = "vymanga_search_genres_v2";

export const SECTIONS = {
  POPULAR: "popular",
  LATEST_UPDATES: "latest_updates",
  TOP_RATED: "top_rated",
  NEWEST: "newest",
  GENRES: "genres",
} as const;

export const BROWSE_SORT: Record<string, string> = {
  [SECTIONS.LATEST_UPDATES]: "updated_at",
  [SECTIONS.TOP_RATED]: "scored",
  [SECTIONS.NEWEST]: "created_at",
};

export const CARD_LINK_SELECTOR = "a";
export const CARD_TITLE_SELECTOR = ".comic-title";
export const CARD_IMAGE_SELECTOR = ".comic-image img, img.image, img.lozad";
export const CARD_LATEST_SELECTOR = ".comic-image > span, .comic-image span";
export const NEXT_PAGE_SELECTOR = "[rel=next]";

export const TITLE_SELECTOR = "h1";
export const THUMB_SELECTOR = ".img-manga img, .content-thumb img";
export const DESC_SELECTOR = ".summary > .content, div.summary p.content";
export const AUTHOR_SELECTOR = ".pre-title:contains(Author) ~ a";
export const ARTIST_SELECTOR = ".pre-title:contains(Artist) ~ a";
export const GENRE_SELECTOR = ".pre-title:contains(Genres) ~ a, div.col-md-7 p a[href*=genre]";
export const STATUS_SELECTOR =
  ".pre-title:contains(Status) ~ span:not(.space), div.col-md-7 p:contains(Status) span";

export const CHAPTER_SELECTOR = "a.list-chapter";
export const CHAPTER_FALLBACK_SELECTOR = 'a[id^="chapter-"]';
export const CHAPTER_DATE_SELECTOR = "p.small";
export const PAGE_SELECTOR = "div.carousel-item[data-page] img, img.lozad, img.d-block";

export const GENRE_OPTION_SELECTOR = ".checkbox-genre[data-value]";

export interface PageMetadata extends JSONObject {
  page?: number;
}

export interface SearchMetadata extends JSONObject {
  author?: string;
  searchType?: string[];
  searchDescription?: boolean;
  status?: string[];
  order?: string[];
  genres?: Record<string, "included" | "excluded">;
}

export type OptionItem = {
  id: string;
  value: string;
};

export type MangaCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
  subtitle?: string;
};

export const STATUS_OPTIONS: Tag[] = [
  { id: "", title: "All" },
  { id: "0", title: "Ongoing" },
  { id: "1", title: "Completed" },
];

export const SORT_OPTIONS: OptionItem[] = [
  { id: "viewed", value: "Most Viewed" },
  { id: "scored", value: "Top Rated" },
  { id: "created_at", value: "Newest" },
  { id: "updated_at", value: "Latest Update" },
];

export const SORTING_OPTIONS = SORT_OPTIONS.map((option) => ({
  id: option.id,
  label: option.value,
}));

export const ORDER_OPTIONS: Tag[] = [
  { id: "desc", title: "Descending" },
  { id: "asc", title: "Ascending" },
];

export const SEARCH_TYPE_OPTIONS: Tag[] = [
  { id: "0", title: "Contains" },
  { id: "1", title: "Begins with" },
  { id: "2", title: "Ends with" },
];

export const ADULT_GENRE_NAMES: ReadonlySet<string> = new Set([
  "adult",
  "mature",
  "smut",
  "ecchi",
  "hentai",
  "erotica",
  "pornographic",
  "18+",
  "nsfw",
]);
