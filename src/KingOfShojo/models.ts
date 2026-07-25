/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type Tag } from "@paperback/types";

export const DEFAULT_DOMAIN = "https://kingofshojo.com";
export const MANGA_DIR = "manga";
export const FEATURED_LIMIT = 10;

export const NEXT_PAGE_SELECTOR = "div.pagination .next, div.hpage .r, a:has(img[alt=Next])";

export const SECTIONS = {
  POPULAR_TODAY: "popular_today",
  LATEST_UPDATE: "latest_update",
  RECOMMENDATION: "recommendation",
  POPULAR_SERIES: "popular_series",
  GENRES: "genres",
} as const;

export const ADULT_GENRE_NAMES: ReadonlySet<string> = new Set([
  "adult",
  "adult content",
  "smut",
  "hentai",
  "erotica",
  "pornographic",
  "ecchi",
  "mature",
  "18+",
  "nsfw",
]);

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  author?: string;
  year?: string;
  status?: string[];
  type?: string[];
  genres?: Record<string, "included" | "excluded">;
  popularRange?: string;
};

export type OptionItem = {
  id: string;
  value: string;
};

export type MangaCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
  subtitle?: string;
  rating?: string;
  isAdult?: boolean;
};

export const POPULAR_RANGE_OPTIONS: OptionItem[] = [
  { id: "wpop-weekly", value: "Weekly" },
  { id: "wpop-monthly", value: "Monthly" },
  { id: "wpop-alltime", value: "All" },
];

export type LatestCard = MangaCard & {
  chapterId?: string;
  chapterName?: string;
  publishDate?: Date;
};

export const STATUS_OPTIONS: Tag[] = [
  { id: "", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "dropped", title: "Dropped" },
];

export const TYPE_OPTIONS: Tag[] = [
  { id: "", title: "All" },
  { id: "Manga", title: "Manga" },
  { id: "Manhwa", title: "Manhwa" },
  { id: "Manhua", title: "Manhua" },
  { id: "Comic", title: "Comic" },
];

export const SORTING_OPTIONS = [
  { id: "", label: "Default" },
  { id: "title", label: "A-Z" },
  { id: "titlereverse", label: "Z-A" },
  { id: "update", label: "Latest Update" },
  { id: "latest", label: "Latest Added" },
  { id: "popular", label: "Popular" },
];
