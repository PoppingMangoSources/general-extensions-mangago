/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://mangaberri.com";

// Ranked genre carousels are "top" lists; keep them short so a long genre
// listing doesn't stuff hundreds of cards into one carousel.
export const RANKED_LIMIT = 30;

export const SECTIONS = {
  MOST_VIEWED: "most-viewed",
  WEEKLY: "weekly",
  SHOUNEN: "shounen",
  LATEST: "latest",
  SEINEN: "seinen",
  POPULAR_TODAY: "popular-today",
  MANHWA_MANHUA: "manhwa-manhua",
  GENRES: "genres",
} as const;

// Home-page headings the discover sections are sliced out of, kept verbatim so
// the parser can locate each block by its own `.section-title`.
export const HOME_TITLES = {
  MOST_VIEWED: "Most Viewed",
  POPULAR_TODAY: "Popular Today",
  LATEST: "Latest Update",
} as const;

// The exact genre query values for the three ranked genre carousels.
export const RANKED_GENRES = {
  SHOUNEN: "Shounen",
  SEINEN: "Seinen",
  MANHWA_MANHUA: "Manhwa/Manhua",
} as const;

export type PageMetadata = {
  page?: number;
  seen?: string[];
};

export type SearchMetadata = {
  genres?: Record<string, "included" | "excluded">;
};

// One manga card as it appears in every listing/carousel; each consumer reads
// only the fields its section renders.
export interface MangaCard {
  slug: string;
  title: string;
  cover: string;
  rating?: string;
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
  { id: "action", value: "Action" },
  { id: "adventure", value: "Adventure" },
  { id: "comedy", value: "Comedy" },
  { id: "crime", value: "Crime" },
  { id: "demons", value: "Demons" },
  { id: "drama", value: "Drama" },
  { id: "ecchi", value: "Ecchi" },
  { id: "fantasy", value: "Fantasy" },
  { id: "girls-love", value: "Girls Love" },
  { id: "gourmet", value: "Gourmet" },
  { id: "harem", value: "Harem" },
  { id: "horror", value: "Horror" },
  { id: "isekai", value: "Isekai" },
  { id: "iyashikei", value: "Iyashikei" },
  { id: "kids", value: "Kids" },
  { id: "magic", value: "Magic" },
  { id: "manhwa-manhua", value: "Manhwa/Manhua" },
  { id: "martial-arts", value: "Martial Arts" },
  { id: "mecha", value: "Mecha" },
  { id: "military", value: "Military" },
  { id: "mystery", value: "Mystery" },
  { id: "parody", value: "Parody" },
  { id: "psychological", value: "Psychological" },
  { id: "romance", value: "Romance" },
  { id: "school", value: "School" },
  { id: "sci-fi", value: "Sci-Fi" },
  { id: "seinen", value: "Seinen" },
  { id: "shoujo", value: "Shoujo" },
  { id: "shounen", value: "Shounen" },
  { id: "slice-of-life", value: "Slice of Life" },
  { id: "space", value: "Space" },
  { id: "sports", value: "Sports" },
  { id: "super-power", value: "Super Power" },
  { id: "supernatural", value: "Supernatural" },
  { id: "thriller", value: "Thriller" },
  { id: "vampire", value: "Vampire" },
];

// Escalate a title to MATURE when its genres say so, otherwise treat it as safe.
export const MATURE_GENRES = ["seinen", "ecchi", "harem", "mature", "adult", "smut"];
