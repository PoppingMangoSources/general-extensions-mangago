/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://hivetoons.org";
export const API_URL = "https://api.hivetoons.org/api";
export const PAGE_SIZE = 18;

export const SECTIONS = {
  POPULAR: "popular",
  NOVELS: "novels",
  HOT: "hot",
  NEW: "new",
  GENRES: "genres",
} as const;

export type PageMetadata = {
  page?: number;
  apiPage?: number;
  apiOffset?: number;
};

export type SearchMetadata = {
  status?: string[];
  type?: string[];
  direction?: string[];
  genres?: Record<string, "included" | "excluded">;
};

export interface HiveScansGenre {
  id: number;
  name: string;
}

export interface HiveScansPost {
  slug: string;
  postTitle: string;
  postContent?: string | null;
  isNovel?: boolean;
  featuredImage?: string | null;
  alternativeTitles?: string | null;
  author?: string | null;
  artist?: string | null;
  seriesType?: string | null;
  seriesStatus?: string | null;
  lastChapterAddedAt?: string | null;
  averageRating?: number | null;
  genres?: HiveScansGenre[];
  chapters?: HiveScansChapter[];
}

export interface HiveScansSearchResponse {
  posts: HiveScansPost[];
  totalCount: number;
}

export interface HiveScansChapter {
  id: number;
  number: number | string;
  title?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  chapterStatus?: string;
  isAccessible?: boolean;
  isLocked?: boolean;
  isPermanentlyLocked?: boolean;
}

export interface HiveScansPostDetailsResponse {
  post: HiveScansPost;
}

export interface HiveScansPageImage {
  url: string;
  order?: number | null;
}

export interface HiveScansChapterData {
  content?: string | null;
  images?: HiveScansPageImage[];
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  isShortLinkLocked?: boolean;
}

export interface HiveScansChapterResponse {
  chapter?: HiveScansChapterData;
}

export const STATUS_OPTIONS: Tag[] = [
  { id: "ONGOING", title: "Ongoing" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "COMPLETED", title: "Completed" },
  { id: "CANCELLED", title: "Cancelled" },
  { id: "DROPPED", title: "Dropped" },
  { id: "COMING_SOON", title: "Coming Soon" },
  { id: "MASS_RELEASED", title: "Mass Released" },
];

export const TYPE_OPTIONS: Tag[] = [
  { id: "NOVEL", title: "Novel" },
  { id: "MANGA", title: "Manga" },
  { id: "MANHUA", title: "Manhua" },
  { id: "MANHWA", title: "Manhwa" },
  { id: "RUSSIAN", title: "Russian" },
  { id: "SPANISH", title: "Spanish" },
];

export const SORT_DIRECTION_OPTIONS: Tag[] = [
  { id: "desc", title: "Descending" },
  { id: "asc", title: "Ascending" },
];

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "lastChapterAddedAt", label: "Last Chapter" },
  { id: "totalViews", label: "Views" },
  { id: "createdAt", label: "Added Date" },
  { id: "chaptersCount", label: "Chapters Count" },
  { id: "postTitle", label: "Alphabetical" },
];
