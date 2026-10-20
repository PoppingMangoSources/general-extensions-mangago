/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const DOMAIN = "https://mangaberri.com";

export const SECTIONS = {
  MOST_READ: "most-read",
  POPULAR: "popular",
  LATEST: "latest",
  GENRES: "genres",
} as const;

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: SECTIONS.MOST_READ, title: "Most Read", type: DiscoverSectionType.featured },
  { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.prominentCarousel },
  { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
  { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
];

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  genre?: string;
  status?: string;
}

// The query the browse page takes, as its own filter form sends it.
export interface BrowseQuery {
  q?: string;
  genre?: string;
  status?: string;
  sort?: string;
}

// A manga card, as the discover and browse pages show it.
export interface MangaCard {
  slug: string;
  title: string;
  cover: string;
  status?: string;
  genre?: string;
  chapters?: string;
}

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "latest", label: "Latest Updates" },
  { id: "popular", label: "Most Read" },
  { id: "title", label: "Title A-Z" },
];

// The browse filter sends each status by its name.
export const STATUS_OPTIONS: Tag[] = [
  { id: "Ongoing", title: "Ongoing" },
  { id: "Finished", title: "Finished" },
  { id: "Discontinued", title: "Discontinued" },
];

// The browse filter sends each genre by its name; the id is a Paperback-safe slug of it.
export const GENRES: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "animals", title: "Animals" },
  { id: "comedy", title: "Comedy" },
  { id: "cooking", title: "Cooking" },
  { id: "crime", title: "Crime" },
  { id: "demons", title: "Demons" },
  { id: "drama", title: "Drama" },
  { id: "ecchi", title: "Ecchi" },
  { id: "fantasy", title: "Fantasy" },
  { id: "girls-love", title: "Girls Love" },
  { id: "gore", title: "Gore" },
  { id: "gourmet", title: "Gourmet" },
  { id: "gyaru", title: "Gyaru" },
  { id: "harem", title: "Harem" },
  { id: "horror", title: "Horror" },
  { id: "isekai", title: "Isekai" },
  { id: "iyashikei", title: "Iyashikei" },
  { id: "josei", title: "Josei" },
  { id: "kids", title: "Kids" },
  { id: "magic", title: "Magic" },
  { id: "manhua", title: "Manhua" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhwa-manhua", title: "Manhwa/Manhua" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "mecha", title: "Mecha" },
  { id: "military", title: "Military" },
  { id: "music", title: "Music" },
  { id: "mystery", title: "Mystery" },
  { id: "ninja", title: "Ninja" },
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
  { id: "space", title: "Space" },
  { id: "sports", title: "Sports" },
  { id: "super-power", title: "Super Power" },
  { id: "supernatural", title: "Supernatural" },
  { id: "survival", title: "Survival" },
  { id: "suspense", title: "Suspense" },
  { id: "thriller", title: "Thriller" },
  { id: "vampire", title: "Vampire" },
];

// Escalate a title to MATURE when its genres say so, otherwise treat it as safe.
export const MATURE_GENRES = ["seinen", "ecchi", "harem", "mature", "adult", "smut"];
