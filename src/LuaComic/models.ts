/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://luacomic.org";
export const API_URL = "https://api.luacomic.org";
export const PAGE_SIZE = 20;

export const SECTIONS = {
  POPULAR: "popular",
  FEATURED: "featured",
  RECOMMENDED: "recommended",
  LATEST: "latest",
  TRENDING: "trending",
  EDITORS: "editors",
  GENRES: "genres",
} as const;

export type OptionItem = {
  id: string;
  value: string;
};

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  status?: string[];
  genres?: Record<string, "included" | "excluded">;
  trending?: string;
};

// Maps to the site's "Order by" dropdown (created_at / updated_at / Views / Title).
export const SORTING_OPTIONS: SortingOption[] = [
  { id: "created_at", label: "Created at" },
  { id: "updated_at", label: "Updated at" },
  { id: "total_views", label: "Views" },
  { id: "title", label: "Title" },
];

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "All", value: "All" },
  { id: "Ongoing", value: "Ongoing" },
  { id: "Hiatus", value: "Hiatus" },
  { id: "Dropped", value: "Dropped" },
  { id: "Completed", value: "Completed" },
];

// Chips shown under the Trending section.
export const TRENDING_RANGES = [
  { id: "daily", title: "Daily" },
  { id: "weekly", title: "Weekly" },
  { id: "all", title: "All Time" },
] as const;

// Used only when the tags endpoint returns nothing.
export const FALLBACK_GENRES: OptionItem[] = [
  { id: "action", value: "Action" },
  { id: "adventure", value: "Adventure" },
  { id: "comedy", value: "Comedy" },
  { id: "drama", value: "Drama" },
  { id: "fantasy", value: "Fantasy" },
  { id: "harem", value: "Harem" },
  { id: "historical", value: "Historical" },
  { id: "horror", value: "Horror" },
  { id: "isekai", value: "Isekai" },
  { id: "josei", value: "Josei" },
  { id: "magic", value: "Magic" },
  { id: "martial-arts", value: "Martial Arts" },
  { id: "mature", value: "Mature" },
  { id: "mystery", value: "Mystery" },
  { id: "psychological", value: "Psychological" },
  { id: "romance", value: "Romance" },
  { id: "school-life", value: "School Life" },
  { id: "sci-fi", value: "Sci-fi" },
  { id: "seinen", value: "Seinen" },
  { id: "shoujo", value: "Shoujo" },
  { id: "shounen", value: "Shounen" },
  { id: "slice-of-life", value: "Slice of Life" },
  { id: "smut", value: "Smut" },
  { id: "supernatural", value: "Supernatural" },
  { id: "thriller", value: "Thriller" },
  { id: "tragedy", value: "Tragedy" },
  { id: "villainess", value: "Villainess" },
];

const ADULT_GENRES = ["adult", "smut", "mature", "ecchi", "hentai", "yaoi", "yuri"];

export const isAdultGenre = (name: string): boolean =>
  ADULT_GENRES.includes(name.trim().toLowerCase());

export interface LuaChapter {
  id: number;
  chapter_name?: string | null;
  chapter_title?: string | null;
  chapter_slug: string;
  created_at?: string | null;
  index?: string | null;
  price?: number | null;
}

export interface LuaTag {
  id?: number | string | null;
  name?: string | null;
}

export interface LuaSeries {
  id: number;
  title: string;
  description?: string | null;
  alternative_names?: string | null;
  series_type?: string | null;
  series_slug: string;
  thumbnail?: string | null;
  total_views?: number | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  badge?: string | null;
  author?: string | null;
  rating?: number | null;
  free_chapters?: LuaChapter[] | null;
  paid_chapters?: LuaChapter[] | null;
  tags?: (string | LuaTag)[] | null;
  meta?: { chapters_count?: string | number | null } | null;
}

export interface LuaQueryResponse {
  meta?: {
    current_page?: number;
    last_page?: number;
    total?: number;
  } | null;
  data?: LuaSeries[] | null;
}

export interface LuaTrendingItem {
  id: number;
  title: string;
  thumbnail?: string | null;
  series_slug: string;
  badge?: string | null;
  status?: string | null;
  description?: string | null;
  meta?: {
    chapters_count?: string | number | null;
    who_bookmarked_count?: string | number | null;
  } | null;
}

export interface LuaBanner {
  id: number;
  banner?: string | null;
  background?: string | null;
  series?: LuaSeries | null;
}

export interface LuaHomePage {
  banners: LuaBanner[];
  recommended: LuaSeries[];
  editors: LuaSeries[];
}
