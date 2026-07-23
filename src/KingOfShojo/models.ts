/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DEFAULT_DOMAIN = "https://kingofshojo.com";
export const MANGA_DIR = "manga";
export const FEATURED_LIMIT = 10;

export const NEXT_PAGE_SELECTOR = "div.pagination .next, div.hpage .r, a:has(img[alt=Next])";

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

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "", value: "All" },
  { id: "ongoing", value: "Ongoing" },
  { id: "completed", value: "Completed" },
  { id: "hiatus", value: "Hiatus" },
  { id: "dropped", value: "Dropped" },
];

export const TYPE_OPTIONS: OptionItem[] = [
  { id: "", value: "All" },
  { id: "Manga", value: "Manga" },
  { id: "Manhwa", value: "Manhwa" },
  { id: "Manhua", value: "Manhua" },
  { id: "Comic", value: "Comic" },
];

export const SORTING_OPTIONS = [
  { id: "", label: "Default" },
  { id: "title", label: "A-Z" },
  { id: "titlereverse", label: "Z-A" },
  { id: "update", label: "Latest Update" },
  { id: "latest", label: "Latest Added" },
  { id: "popular", label: "Popular" },
];
