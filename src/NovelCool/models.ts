/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://www.novelcool.com";
export const API_URL = "https://api.novelcool.com";
export const PAGE_SIZE = 20;

export const API_HEADERS = {
  "content-type": "application/x-www-form-urlencoded",
  "user-agent":
    "Android/Package:com.zuoyou.novel - Version Name:2.3 - Phone Info:sdk_gphone_x86_64(Android Version:13)",
} as const;

export const API_PARAMETERS = {
  appId: "202201290625004",
  secret: "c73a8590641781f203660afca1d37ada",
  package_name: "com.zuoyou.novel",
  lang: "en",
} as const;

export const REQUIRED_COOKIES = [
  "novelcool_webp_valid=true",
  "protocol_cookie_is_show=1",
  "protocol_cookie_is_allow=1",
  "novelcool_list_num=10",
] as const;

export const SECTIONS = {
  FEATURED: "featured",
  LATEST: "latest",
  POPULAR: "popular",
  COMPLETED: "completed",
  GENRES: "genres",
} as const;

export const CATEGORY_PATHS = {
  RATING: "/category/index.html",
  LATEST: "/category/latest.html",
  POPULAR: "/category/popular.html",
  NEWEST: "/category/new_list.html",
  COMPLETED: "/category/completed.html",
} as const;

export const STATE_KEYS = {
  RELATIVE_DATE_ANCHOR: "novelcool_relative_date_anchor",
} as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest" },
  { id: "popular", label: "Popular" },
  { id: "newest", label: "Newest" },
  { id: "rating", label: "Rating" },
];

export const MATCH_OPTIONS: Tag[] = [
  { id: "contain", title: "Contain" },
  { id: "begin", title: "Begin" },
  { id: "end", title: "End" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "NO", title: "Ongoing" },
  { id: "YES", title: "Completed" },
];

export const RATING_OPTIONS: Tag[] = [
  { id: "5", title: "5 Stars" },
  { id: "4", title: "4 Stars and Up" },
  { id: "3", title: "3 Stars and Up" },
  { id: "2", title: "2 Stars and Up" },
];

export const TYPE_TITLES = new Set([
  "comic",
  "comics",
  "manga",
  "manhua",
  "manhwa",
  "novel",
  "web comic",
  "web novel",
  "webtoon",
  "webtoons",
]);

export type ContentType = "manga" | "novel";
export type BrowseOrder = "hot" | "latest" | "new_book";

export interface PageMetadata extends JSONObject {
  page: number;
}

export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  nameMethod?: string[];
  author?: string;
  authorMethod?: string[];
  status?: string[];
  genres?: TriState;
  year?: string[];
  rating?: string[];
}

export interface SearchRequest {
  page: number;
  title?: string;
  nameMethod?: string;
  author?: string;
  authorMethod?: string;
  status?: string;
  genresInclude?: string[];
  genresExclude?: string[];
  year?: string;
  rating?: string;
}

export interface ListingChapter {
  chapterId: string;
  title: string;
  dateText?: string;
}

export interface ListingItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  type?: string;
  status?: string;
  rating?: number;
  description?: string;
  genres: string[];
  updatedText?: string;
  latestChapter?: ListingChapter;
}

export interface SearchOptions {
  genres: Tag[];
  years: Tag[];
}

export interface ApiResponse {
  error_code: string;
  error_msg?: string;
}

export interface NovelCoolBook {
  id: string;
  book_id?: string;
  url?: string;
  visit_path?: string;
  name: string;
  alternative?: string;
  publish_year?: string;
  author?: string;
  artist?: string;
  intro?: string;
  completed?: string;
  category_list?: string[];
  last_chapter_id?: string;
  last_chapter_title?: string;
  modify_time?: string;
  rate_star?: string;
  all_views?: string;
  is_novel?: string;
  cover: string;
}

export interface BrowseResponse extends ApiResponse {
  list?: NovelCoolBook[] | null;
}

export interface BookInfoResponse extends ApiResponse {
  info?: NovelCoolBook | null;
}

export interface NovelCoolChapter {
  id: string;
  book_id: string;
  title: string;
  order_id?: string;
  last_modify?: string;
  tf_time?: string;
  is_locked?: boolean | string | number;
}

export interface ChapterListResponse extends ApiResponse {
  list?: NovelCoolChapter[] | null;
}

export interface NovelCoolPage {
  pic_path: string;
  order_id?: number;
}

export interface NovelCoolChapterInfo extends NovelCoolChapter {
  content?: string;
  pic_list?: NovelCoolPage[];
  url?: string;
}

export interface ChapterInfoResponse extends ApiResponse {
  info?: NovelCoolChapterInfo | null;
}
