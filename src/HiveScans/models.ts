/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://hivetoons.org";
export const API_URL = "https://api.hivetoons.org/api";
export const PAGE_SIZE = 18;
export const GENRES_CACHE_TTL = 60 * 60 * 1000;

export const SECTION_POPULAR = "popular";
export const SECTION_HOT = "hot";
export const SECTION_NEW = "new";
export const SECTION_GENRES = "genres";

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

export type OptionItem = {
  id: string;
  value: string;
};

export interface HiveToonsGenre {
  id: number;
  name: string;
}

export interface HiveToonsPost {
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
  genres?: HiveToonsGenre[];
  chapters?: HiveToonsChapter[];
}

export interface HiveToonsSearchResponse {
  posts: HiveToonsPost[];
  totalCount: number;
}

export interface HiveToonsChapter {
  id: number;
  number: number | string;
  title?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  chapterStatus: string;
  isAccessible: boolean;
  isLocked?: boolean;
  isTimeLocked?: boolean;
}

export interface HiveToonsPostDetails extends HiveToonsPost {
  chapters: HiveToonsChapter[];
}

export interface HiveToonsPostDetailsResponse {
  post: HiveToonsPostDetails;
}

export interface HiveToonsPageImage {
  url: string;
  order?: number | null;
}

export interface HiveToonsChapterData {
  images: HiveToonsPageImage[];
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  isShortLinkLocked?: boolean;
}

export interface HiveToonsChapterResponse {
  chapter?: HiveToonsChapterData;
}

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "ONGOING", value: "Ongoing" },
  { id: "COMPLETED", value: "Completed" },
  { id: "CANCELLED", value: "Cancelled" },
  { id: "DROPPED", value: "Dropped" },
  { id: "COMING_SOON", value: "Coming Soon" },
  { id: "MASS_RELEASED", value: "Mass Released" },
];

export const TYPE_OPTIONS: OptionItem[] = [
  { id: "MANGA", value: "Manga" },
  { id: "MANHUA", value: "Manhua" },
  { id: "MANHWA", value: "Manhwa" },
  { id: "RUSSIAN", value: "Russian" },
  { id: "SPANISH", value: "Spanish" },
];

export const SORT_DIRECTION_OPTIONS: OptionItem[] = [
  { id: "desc", value: "Descending" },
  { id: "asc", value: "Ascending" },
];

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "lastChapterAddedAt", label: "Last Chapter" },
  { id: "totalViews", label: "Views" },
  { id: "createdAt", label: "Added Date" },
  { id: "chaptersCount", label: "Chapters Count" },
  { id: "postTitle", label: "Alphabetical" },
];