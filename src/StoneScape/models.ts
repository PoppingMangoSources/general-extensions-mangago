/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ContentRating, JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://stonescape.xyz";
export const API_URL = `${DOMAIN}/api`;
export const PAGE_SIZE = 20;

export const SECTIONS = {
  FEATURED: "featured",
  POPULAR: "popular",
  LATEST: "latest",
  NOVELS: "novels",
  LATEST_NOVELS: "latest_novels",
  POPULAR_NOVELS: "popular_novels",
  GENRES: "genres",
} as const;

export const STATE_KEYS = {
  SHOW_LOCKED_CHAPTERS: "stonescape_show_locked_chapters",
} as const;

export const PERIOD_OPTIONS = [
  { id: "week", title: "Week" },
  { id: "month", title: "Month" },
  { id: "year", title: "Year" },
] as const;

export type PopularPeriod = (typeof PERIOD_OPTIONS)[number]["id"];
export type ContentType = "manhwa" | "novel";

export const STATUS_OPTIONS: Tag[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

export const CONTENT_TYPE_OPTIONS: Tag[] = [
  { id: "manhwa", title: "Manhwa / Manga" },
  { id: "novel", title: "Novels" },
];

export const SORT_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest" },
  { id: "popular_month", label: "Popular This Month" },
  { id: "popular_year", label: "Popular This Year" },
  { id: "title", label: "A–Z" },
  { id: "title_desc", label: "Z–A" },
];

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  status?: string[];
  contentType?: string[];
  genres?: string[];
  popularPeriod?: PopularPeriod;
}

export interface SeriesChapter {
  chapterId: string;
  chapterNumber: string;
  title?: string | null;
  status?: string | null;
  createdAt?: string | null;
}

export interface Series {
  seriesId: string;
  title: string;
  slug: string;
  originalTitle?: string | null;
  originalSourceUrl?: string | null;
  artist?: string | null;
  author?: string | null;
  coverUrl?: string | null;
  bannerUrl?: string | null;
  description?: string | null;
  publicationStatus?: string | null;
  countryOfOrigin?: string | null;
  contentType?: ContentType;
  updatedAt?: string | null;
  lastChapterUploadedAt?: string | null;
  genres?: string[];
  chapterCount?: number;
  latestChapter?: SeriesChapter | null;
  recentChapters?: SeriesChapter[];
  bookmarkCount?: number;
  currentMonthViews?: number;
  averageRating?: number | null;
  ratingCount?: number;
  totalViews?: string | number | null;
}

export interface SeriesResponse {
  data: Series[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface BannerResponse {
  featuredSeries: Series[];
  showNovelSection?: boolean;
}

export interface PopularSeriesResponse {
  data: Series[];
}

export interface Genre {
  slug: string;
  label: string;
}

export interface GenreResponse {
  genres: Genre[];
}

export interface SeriesChapterDetails extends SeriesChapter {
  thumbnailUrl?: string | null;
  releaseDate?: string | null;
  price?: number | null;
  likeCount?: number;
  isFreeNow?: boolean;
  freeAt?: string | null;
  isPurchased?: boolean;
}

export interface ChapterListResponse {
  chapters: SeriesChapterDetails[];
}

export interface ChapterPage {
  pageId?: string;
  pageNumber?: number;
  url: string;
  width?: number;
  height?: number;
}

export interface ChapterPagesResponse {
  pages?: ChapterPage[];
  images?: ChapterPage[];
  noteBeforeHtml?: string | null;
  noteAfterHtml?: string | null;
}

export interface NovelIllustration {
  pageId: string;
  pageNumber: number;
  imageUrl: string;
}

export interface NovelChapterResponse extends SeriesChapterDetails {
  contentHtml?: string | null;
  noteBeforeHtml?: string | null;
  noteAfterHtml?: string | null;
  illustrations?: NovelIllustration[];
}

export interface MangaListItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  bannerUrl?: string;
  summary?: string;
  author?: string;
  status?: string;
  rating?: number;
  views?: number;
  contentRating: ContentRating;
  contentType: ContentType;
}

export interface SeriesQuery {
  page: number;
  limit?: number;
  contentType?: ContentType;
  genres?: string[];
  status?: string;
  search?: string;
  sort?: string;
}
