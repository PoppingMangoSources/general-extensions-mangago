/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ContentRating, JSONObject, SortingOption, Tag } from "@paperback/types";
export const DOMAIN = "https://mgread.io";
export const PAGE_SIZE = 24;
export const SECTIONS = {
  POPULAR: "popular",
  RATED: "rated",
  TOP: "top",
  LATEST: "latest",
  FOLLOWS: "follows",
  POWER: "power",
} as const;
export const SORT_OPTIONS: SortingOption[] = [
  { id: "updated", label: "Latest Updated" },
  { id: "new", label: "Newest" },
  { id: "old", label: "Oldest" },
  { id: "views", label: "Most Views" },
  { id: "views_day", label: "Daily Views" },
  { id: "views_week", label: "Weekly Views" },
  { id: "views_month", label: "Monthly Views" },
  { id: "rating", label: "Highest Rating" },
  { id: "power", label: "Power Ranking" },
  { id: "follow", label: "Most Followers" },
];
export const TYPE_OPTIONS: Tag[] = [
  { id: "comic", title: "Comic" },
  { id: "oneshot", title: "Oneshot" },
  { id: "novel", title: "Novel" },
];
export const STATUS_OPTIONS: Tag[] = [
  "ongoing",
  "season_end",
  "completed",
  "source_hiatus",
  "caught_up",
  "dropped",
].map((id) => ({
  id,
  title: id
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" "),
}));
export const AGE_OPTIONS: Tag[] = [
  { id: "all", title: "All ages" },
  { id: "13+", title: "13+" },
  { id: "16+", title: "16+" },
  { id: "18+", title: "18+" },
];
export const STAR_OPTIONS: Tag[] = [1, 2, 3, 4, 5].map((value) => ({
  id: String(value),
  title: `${value} stars`,
}));
export const TOP_OPTIONS = [
  { id: "day", title: "Day" },
  { id: "week", title: "Week" },
  { id: "month", title: "Month" },
] as const;
export const STATE_KEYS = {
  RATINGS: "mgread_ratings",
  GENRES: "mgread_genres",
  HIDE_LOCKED: "mgread_hide_locked",
} as const;
export interface PageMetadata extends JSONObject {
  page: number;
}
export interface SearchMetadata extends JSONObject {
  genres?: string[];
  status?: string[];
  types?: string[];
  age?: string[];
  ratingMin?: string[];
  ratingMax?: string[];
  topWindow?: string;
}
export interface Preferences {
  ratings: string[];
  excludedGenres: string[];
  hideLocked: boolean;
}
export interface ListingChapter {
  id: string;
  number?: number;
  date?: Date;
}
export interface MangaListItem {
  id: string;
  title: string;
  cover: string;
  genres: string[];
  rating?: number;
  views?: string;
  follows?: string;
  latest?: ListingChapter;
  chapterCount?: number;
  summary?: string;
  contentRating: ContentRating;
}
export interface ChapterRecord {
  id: number;
  slug: string;
  number: number;
  title: string;
  created_at: string;
  lock_type: string;
  is_purchased: boolean;
}
export interface ChapterListResponse {
  items: ChapterRecord[];
  total_pages: number;
  current_page: number;
}
export interface SearchItem {
  post_type?: string;
  title: string;
  url: string;
  thumbnail?: string;
  thumb?: string;
  image?: string;
}
export interface ReaderProtection {
  encrypted: {
    mode?: string;
    cid?: number;
    e?: number;
    g?: string;
    iv: string;
    salt?: string;
    ciphertext: string;
  };
  config: { nonce?: string; headlessGuardEnabled?: string | boolean; decryption_key?: string };
}

export interface TaxonomyItem {
  slug: string;
  class_list: string[];
}
