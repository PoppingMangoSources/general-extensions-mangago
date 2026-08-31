/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type JSONObject, type Tag } from "@paperback/types";

export const DOMAIN = "https://violetscans.org";

export const STATE_KEYS = {
  SHOW_LOCKED_CHAPTERS: "violetscans_show_locked_chapters",
} as const;

export type StateKey = (typeof STATE_KEYS)[keyof typeof STATE_KEYS];

export const SECTIONS = {
  MOST_POPULAR: "most_popular",
  POPULAR_TODAY: "popular_today",
  NEW_SERIES: "new_series",
  LATEST_COMICS: "latest_comics",
  EDITOR_PICKS: "editor_picks",
  LATEST_NOVELS: "latest_novels",
  LATEST_MANGA: "latest_manga",
  FEATURED: "featured",
  COMPLETED: "completed",
  GENRES: "genres",
} as const;

export const LOCKED_CHAPTER_PREFIX = "locked:";

// Paperback rejects ids containing characters outside this set.
export const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

export interface PageMetadata extends JSONObject {
  page?: number;
  initialOrganicCount?: number;
  displayedPinIds?: string;
  anchorTimestamp?: number;
}

export interface SearchMetadata extends JSONObject {
  genres?: Record<string, "included" | "excluded">;
  status?: string[];
  type?: string[];
}

export type GenreOption = Tag & {
  value: string;
};

export type MangaListItem = {
  mangaId: string;
  title: string;
  imageUrl: string;
  rating?: number;
  status?: string;
  chapterName?: string;
  isNovel: boolean;
  genres?: string[];
  chapterId?: string;
  publishDate?: Date;
  isLocked?: boolean;
};

export type MangaListKind = "cards" | "chapterUpdates" | "editorPicks" | "featured";

export type ChapterUpdateKind = "comics" | "novels";

export type ReaderPayload = {
  protected?: boolean;
  is_novel?: boolean;
  sources?: {
    images?: string[];
  }[];
};

export const ADULT_GENRES = ["adult", "smut"];
export const MATURE_GENRES = ["ecchi", "mature"];

export const STATUS_OPTIONS: Tag[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

export const TYPE_OPTIONS: Tag[] = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "comic", title: "Comic" },
  { id: "novel", title: "Novel" },
];

export const SORTING_OPTIONS = [
  { id: "", label: "Default" },
  { id: "title", label: "A-Z" },
  { id: "titlereverse", label: "Z-A" },
  { id: "update", label: "Update" },
  { id: "latest", label: "Added" },
  { id: "popular", label: "Popular" },
];
