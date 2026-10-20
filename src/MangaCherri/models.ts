/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://mangacherri.com";

export const SECTIONS = {
  MOST_VIEWED: "most-viewed",
  UNFOLDING: "unfolding",
  LATEST: "latest",
  COMPLETED: "completed",
  RECENTLY_ADDED: "recently-added",
  GENRES: "genres",
} as const;

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: SECTIONS.MOST_VIEWED, title: "Most Viewed", type: DiscoverSectionType.featured },
  {
    id: SECTIONS.UNFOLDING,
    title: "Stories Still Unfolding",
    type: DiscoverSectionType.prominentCarousel,
  },
  { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  { id: SECTIONS.COMPLETED, title: "Completed", type: DiscoverSectionType.simpleCarousel },
  {
    id: SECTIONS.RECENTLY_ADDED,
    title: "Recently Added",
    type: DiscoverSectionType.simpleCarousel,
  },
  { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
];

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  genre?: string;
  status?: string;
}

// The query the catalogue page takes, as its own filter form sends it.
export interface CatalogueQuery {
  q?: string;
  genre?: string;
  status?: string;
  sort?: string;
}

// A manga card, as the home page's grids and the catalogue's list both show it.
export interface MangaCard {
  slug: string;
  title: string;
  cover: string;
  status?: string;
  rating?: string;
  genres: string[];
  chapterId?: string;
  chapterLabel?: string;
  postedAt?: string;
}

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "updated", label: "Recently Updated" },
  { id: "added", label: "Newly Added" },
  { id: "popular", label: "Most Viewed" },
  { id: "chapters", label: "Most Chapters" },
  { id: "title", label: "Title A-Z" },
  { id: "title_desc", label: "Title Z-A" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

// The catalogue's genre filter; each id is the slug its /genre/<slug> links use.
export const GENRES: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "animals", title: "Animals" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "drama", title: "Drama" },
  { id: "fantasy", title: "Fantasy" },
  { id: "gyaru", title: "Gyaru" },
  { id: "harem", title: "Harem" },
  { id: "isekai", title: "Isekai" },
  { id: "iyashikei", title: "Iyashikei" },
  { id: "josei", title: "Josei" },
  { id: "magic", title: "Magic" },
  { id: "manhua", title: "Manhua" },
  { id: "manhwa", title: "Manhwa" },
  { id: "music", title: "Music" },
  { id: "mystery", title: "Mystery" },
  { id: "office", title: "Office" },
  { id: "oneshot", title: "Oneshot" },
  { id: "parody", title: "Parody" },
  { id: "psychological", title: "Psychological" },
  { id: "romance", title: "Romance" },
  { id: "school", title: "School" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-Fi" },
  { id: "seinen", title: "Seinen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shounen", title: "Shounen" },
  { id: "slice-of-life", title: "Slice of Life" },
  { id: "sports", title: "Sports" },
  { id: "super-power", title: "Super Power" },
  { id: "supernatural", title: "Supernatural" },
  { id: "vampire", title: "Vampire" },
];

// Romance manhwa can carry suggestive content; escalate a title to MATURE when
// its genres say so, otherwise treat it as safe.
export const MATURE_GENRES = ["josei", "seinen", "mature", "adult", "smut", "ecchi"];
