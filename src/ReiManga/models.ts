/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://reimanga.net";
export const API = `${DOMAIN}/api`;

export const SECTIONS = {
  FEATURED: "featured",
  MOST_READ: "most-read",
  NEW: "new-manga",
  LATEST: "latest",
  TOP_RATED: "top-rated",
  GENRES: "genres",
} as const;

export const PERIODS: Tag[] = [
  { id: "day", title: "Day" },
  { id: "week", title: "Week" },
  { id: "month", title: "Month" },
];

export interface PageMetadata extends JSONObject {
  page?: number;
}

export interface SearchMetadata extends JSONObject {
  status?: string[];
  genres?: Record<string, "included" | "excluded">;
  // Set by the Most Read chips so the search runs against that ranking
  // instead of the regular catalogue query.
  period?: string;
}

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest Update" },
  { id: "newest", label: "Newest" },
  { id: "viewed", label: "Most Viewed" },
  { id: "scored", label: "Top Rated" },
  { id: "title", label: "Title A-Z" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

// The site's own genre menu. The catalogue accepts any genre slug, so this is
// only the picker's vocabulary, not a limit on what a search can ask for.
export const GENRES: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "horror", title: "Horror" },
  { id: "mahou-shoujo", title: "Mahou Shoujo" },
  { id: "mecha", title: "Mecha" },
  { id: "music", title: "Music" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "scifi", title: "Sci-fi" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "thriller", title: "Thriller" },
];

export const ADULT_GENRES = ["ecchi", "smut", "adult", "mature", "yaoi", "yuri", "hentai"];

// --- API payloads -----------------------------------------------------------

export interface ApiTag {
  name?: string;
  slug?: string;
}

export interface ApiManga {
  id: number;
  title?: string;
  name?: string;
  alt_title?: string | null;
  name_url?: string;
  description?: string | null;
  cover_url?: string | null;
  completed?: number;
  view_count?: number;
  rating?: number | string;
  voted?: number;
  is_adult?: number;
  blur_cover?: number;
  chapter_number?: string | number | null;
  chapter_title?: string | null;
  chapter_updated_at?: string | null;
  release_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  recent_reads?: number;
  genres?: (string | ApiTag)[];
  genre_slugs?: string | null;
  tags?: (string | ApiTag)[];
  authors?: (string | ApiTag)[];
}

export interface ApiPagination {
  currentPage?: number;
  totalPages?: number;
}

export interface ApiMangaList {
  data?: ApiManga[];
  pagination?: ApiPagination;
}

export interface ApiMangaDetails {
  manga?: ApiManga;
}

// Chapter lists and reader pages are only in the route's server payload, not
// behind a JSON endpoint of their own.
export interface FlightChapter {
  id: number;
  name?: string;
  uploadDate?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export interface FlightChapterList {
  manga?: { id?: number; slug?: string; name_url?: string };
  chapters?: FlightChapter[];
}

export interface FlightImage {
  page_number?: number;
  image_url?: string;
  url?: string;
}

export interface FlightImages {
  images?: FlightImage[];
}
