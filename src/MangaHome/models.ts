/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://www.mangahome.com";

export const SECTIONS = {
  FEATURED: "featured",
  HOT_YAOI: "hot-yaoi",
  NEW_SHOUJO: "new-shoujo",
  LATEST: "latest",
  TOP_SHOUJO_WEEK: "top-shoujo-week",
  COMPLETED_SHOUJO: "completed-shoujo",
  TOP_VIEWED_SHOUJO: "top-viewed-shoujo",
  TOP_RATED_SHOUJO: "top-rated-shoujo",
  MOST_VIEWED_YAOI: "most-viewed-yaoi",
  TOP_YAOI_WEEK: "top-yaoi-week",
  AWESOME: "awesome",
} as const;

// Home-page recommendation blocks, matched by their heading text.
export const HOME_TITLES = {
  FEATURED: "Featured Manga",
  HOT_YAOI: "Hot Yaoi Manga Releases",
  NEW_SHOUJO: "New Shoujo Manga",
  COMPLETED_SHOUJO: "Completed Shoujo Manga",
} as const;

// Ranking blocks on /rank; each heading wraps its name in an <em> followed by
// the period ("This Week"), so the em text alone identifies the block.
// The feelings ranking tabs render in this order on /rank.
export const AWESOME_TAB_INDEX = 4;

export const RANK_TITLES = {
  SHOUJO: "Shoujo Manga Ranking",
  YAOI: "Yaoi Manga Ranking",
} as const;

// Directory listings order results with a bare query key (e.g. ?rating.za)
// rather than a key=value pair; an empty token is the site's default (views).
export const SORT_OPTIONS: SortingOption[] = [
  { id: "views", label: "Views" },
  { id: "rating", label: "Rating" },
  { id: "az", label: "A-Z" },
  { id: "latest", label: "Latest Updated" },
];

export const SORT_TOKENS: Record<string, string> = {
  views: "",
  rating: "rating.za",
  az: "name.az",
  latest: "last_chapter_time.za",
};

export const GENRES: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "harem", title: "Harem" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "josei", title: "Josei" },
  { id: "mature", title: "Mature" },
  { id: "mecha", title: "Mecha" },
  { id: "mystery", title: "Mystery" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "sci-fi", title: "Sci-fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shounen", title: "Shounen" },
  { id: "sports", title: "Sports" },
  { id: "supernatural", title: "Supernatural" },
  { id: "tragedy", title: "Tragedy" },
  { id: "yaoi", title: "Yaoi" },
  { id: "yuri", title: "Yuri" },
];

// Option ids are the exact values the site's search form submits.
export const TYPE_OPTIONS: Tag[] = [
  { id: "", title: "Any" },
  { id: "manga", title: "Japanese Manga" },
  { id: "manhwa", title: "Korean Manhwa" },
  { id: "manhua", title: "Chinese Manhua" },
];

export const MATCH_OPTIONS: Tag[] = [
  { id: "cw", title: "Contains" },
  { id: "bw", title: "Begins with" },
  { id: "ew", title: "Ends with" },
];

export const YEAR_OPTIONS: Tag[] = [
  { id: "eq", title: "In" },
  { id: "lt", title: "Before" },
  { id: "gt", title: "After" },
];

export const RATING_MATCH_OPTIONS: Tag[] = [
  { id: "eq", title: "Is" },
  { id: "lt", title: "Less than" },
  { id: "gt", title: "More than" },
];

export const RATING_OPTIONS: Tag[] = [
  { id: "", title: "Any star" },
  { id: "0", title: "No star" },
  { id: "1", title: "1 star" },
  { id: "2", title: "2 stars" },
  { id: "3", title: "3 stars" },
  { id: "4", title: "4 stars" },
  { id: "5", title: "5 stars" },
];

export const COMPLETED_OPTIONS: Tag[] = [
  { id: "", title: "Either" },
  { id: "1", title: "Completed" },
  { id: "0", title: "Ongoing" },
];

export type TriState = Record<string, "included" | "excluded">;

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  type?: string[];
  nameMatch?: string[];
  author?: string;
  authorMatch?: string[];
  artist?: string;
  artistMatch?: string[];
  genres?: TriState;
  released?: string;
  releasedMatch?: string[];
  rating?: string[];
  ratingMatch?: string[];
  completed?: string[];
}

// Everything the site's advanced search form can submit.
export interface SearchRequest {
  name?: string;
  nameMethod?: string;
  author?: string;
  authorMethod?: string;
  artist?: string;
  artistMethod?: string;
  type?: string;
  includedGenres?: string[];
  excludedGenres?: string[];
  released?: string;
  releasedMethod?: string;
  rating?: string;
  ratingMethod?: string;
  isCompleted?: string;
}

export interface ListingChapter {
  chapterId: string;
  label: string;
  chapNum?: number;
}

export interface MangaListItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  genres: string[];
  rating?: number;
  views?: number;
  rank?: number;
  chapter?: ListingChapter;
  updatedAt?: Date;
}
