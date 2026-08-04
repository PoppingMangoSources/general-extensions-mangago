/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://mangacherri.com";

export const SECTIONS = {
  POPULAR: "most-popular",
  WEEKLY: "weekly",
  LATEST: "latest",
  POPULAR_NOW: "popular-now",
  COMPLETED: "completed-romance",
  GENRES: "genres",
} as const;

// Home-page headings the discover sections are sliced out of; kept verbatim so
// the parser can locate each carousel by its own `.section-title`.
export const HOME_TITLES = {
  POPULAR: "Most Popular",
  LATEST: "Latest Chapter",
  POPULAR_NOW: "Popular Now",
  COMPLETED: "Completed Romance Manga",
} as const;

export type PageMetadata = {
  page?: number;
  seen?: string[];
};

export type SearchMetadata = {
  genres?: Record<string, "included" | "excluded">;
};

// A single manga card as it appears in every listing/carousel on the site; each
// consumer reads only the fields its section renders.
export interface MangaCard {
  slug: string;
  title: string;
  cover: string;
  rating?: string;
  views?: string;
  chapterId?: string;
  chapterLabel?: string;
  updatedAt?: string;
  genres: string[];
}

// The site browses one genre at a time via /genre.php?genre=<Name>, so the id is
// a Paperback-safe slug and the value is the exact name the query param needs.
export interface Genre {
  id: string;
  value: string;
}

export const GENRES: Genre[] = [
  { id: "adventure", value: "Adventure" },
  { id: "animals", value: "Animals" },
  { id: "comedy", value: "Comedy" },
  { id: "drama", value: "Drama" },
  { id: "fantasy", value: "Fantasy" },
  { id: "gyaru", value: "Gyaru" },
  { id: "isekai", value: "Isekai" },
  { id: "josei", value: "Josei" },
  { id: "magic", value: "Magic" },
  { id: "manhua", value: "Manhua" },
  { id: "manhwa", value: "Manhwa" },
  { id: "music", value: "Music" },
  { id: "mystery", value: "Mystery" },
  { id: "office", value: "Office" },
  { id: "parody", value: "Parody" },
  { id: "psychological", value: "Psychological" },
  { id: "romance", value: "Romance" },
  { id: "school", value: "School" },
  { id: "sci-fi", value: "Sci-fi" },
  { id: "seinen", value: "Seinen" },
  { id: "shoujo", value: "Shoujo" },
  { id: "shounen", value: "Shounen" },
  { id: "slice-of-life", value: "Slice of Life" },
  { id: "sports", value: "Sports" },
  { id: "supernatural", value: "Supernatural" },
];

// Romance manhwa can carry suggestive content; escalate a title to MATURE when
// its genres say so, otherwise treat it as safe.
export const MATURE_GENRES = ["josei", "seinen", "mature", "adult", "smut", "ecchi"];
