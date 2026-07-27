/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://likemanga.ink";
export const PAGE_SIZE = 36;

export const SECTIONS = {
  MOST_FOLLOWED: "most_followed",
  NEW_MANGA: "new_manga",
  LATEST_RELEASES: "latest_releases",
  TOP_SERIES: "top_series",
  HOT: "hot",
  GENRES: "genres",
} as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "lastest-chap", label: "Latest Chapter" },
  { id: "lastest-manga", label: "Newest Manga" },
  { id: "top-manga", label: "Most Viewed" },
  { id: "top-month", label: "Top This Month" },
  { id: "top-week", label: "Top This Week" },
  { id: "top-day", label: "Top Today" },
  { id: "follow", label: "Most Followed" },
  { id: "comment", label: "Most Commented" },
  { id: "num-chap", label: "Most Chapters" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "Complete", title: "Complete" },
  { id: "In process", title: "In process" },
  { id: "Pause", title: "Pause" },
];

export const MIN_CHAPTER_OPTIONS: Tag[] = [
  { id: "1", title: "0 or more" },
  { id: "50", title: "50 or more" },
  { id: "100", title: "100 or more" },
  { id: "200", title: "200 or more" },
  { id: "300", title: "300 or more" },
  { id: "400", title: "400 or more" },
  { id: "500", title: "500 or more" },
];

export const TOP_SERIES_OPTIONS = [
  { id: "top-month", title: "Month" },
  { id: "top-week", title: "Week" },
  { id: "top-day", title: "Day" },
] as const;

export type TopSeriesSort = (typeof TOP_SERIES_OPTIONS)[number]["id"];

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  genres?: string[];
  minChapters?: string[];
  status?: string[];
  topSeriesSort?: TopSeriesSort;
}

export interface SearchRequest {
  page: number;
  keyword?: string;
  sortBy?: string;
  status?: string;
  genres?: string[];
  minChapters?: string;
}

export interface ListingChapter {
  chapterId: string;
  title: string;
  dateText: string;
  isNew: boolean;
}

export interface MangaListItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  alternativeTitle?: string;
  description?: string;
  genres: string[];
  status?: string;
  views?: string;
  comments?: string;
  follows?: string;
  rating?: number;
  updatedDate?: Date;
  chapters: ListingChapter[];
}

export interface NewMangaItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  chapter?: ListingChapter;
}

export interface ChapterAjaxResponse {
  list_chap: string;
  nav?: string;
}

export interface ChapterPageInfo {
  mangaNumericId?: string;
  lastPage: number;
}
