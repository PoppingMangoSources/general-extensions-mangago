/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// HiveScans pulls from the hivetoons.org JSON API (api.hivetoons.org).

export const DOMAIN = "https://hivetoons.org";
export const DOMAIN_API = "https://api.hivetoons.org/api";

export const PAGE_SIZE = 18;

// Prefix shown on chapters the account can't currently read (locked/paid).
export const LOCK_PREFIX = "🔒 ";

export type Metadata = {
  page?: number;
};

// Persisted advanced-search selections. Status/type/direction are single
// select (stored as arrays to match SelectRow); genres are inclusive
// multi-select, matching the API's comma-joined `genreIds`.
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

// --- API response DTOs (subset of the fields this extension uses) ---

export interface HiveScansGenre {
  id: number;
  name: string;
}

export interface HiveScansPost {
  id: number;
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
  genres?: HiveScansGenre[];
}

export interface HiveScansSearchResponse {
  posts: HiveScansPost[];
  totalCount: number;
}

export interface HiveScansChapter {
  id: number;
  slug: string;
  number: number | string;
  title?: string | null;
  createdAt: string;
  chapterStatus: string;
  isAccessible: boolean;
  isLocked?: boolean;
  isTimeLocked?: boolean;
}

export interface HiveScansPostDetails extends HiveScansPost {
  chapters: HiveScansChapter[];
}

export interface HiveScansPostDetailsResponse {
  post: HiveScansPostDetails;
}

export interface HiveScansPageImage {
  url: string;
  order?: number | null;
}

export interface HiveScansPage {
  images: HiveScansPageImage[];
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  isShortLinkLocked?: boolean;
}

// The `/api/chapter` endpoint wraps the page data in a `chapter` envelope.
export interface HiveScansChapterResponse {
  chapter?: HiveScansPage;
}

// Static filter option sets (genres are fetched at runtime).
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

export const DIRECTION_OPTIONS: OptionItem[] = [
  { id: "desc", value: "Descending" },
  { id: "asc", value: "Ascending" },
];
