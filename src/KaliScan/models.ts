/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const MIRRORS: Tag[] = [
  { id: "https://kaliscan.com", title: "kaliscan.com" },
  { id: "https://kaliscan.me", title: "kaliscan.me" },
  { id: "https://kaliscan.io", title: "kaliscan.io" },
  { id: "https://mgjinx.com", title: "mgjinx.com" },
];

export const DOMAIN = MIRRORS[0].id;

export const SECTIONS = {
  POPULAR: "popular",
  TOP: "top",
  HOT: "hot-updates",
  LATEST: "latest",
  NEWEST: "newest",
  REVIEWS: "top-reviews",
  GENRES: "genres",
} as const;

export const TOP_RANGES: Tag[] = [
  { id: "day", title: "Day" },
  { id: "week", title: "Week" },
  { id: "month", title: "Month" },
];

export type OptionItem = {
  id: string;
  value: string;
};

export interface PageMetadata extends JSONObject {
  page?: number;
  seen?: string[];
}

export interface SearchMetadata extends JSONObject {
  status?: string[];
  author?: string;
  genres?: Record<string, "included" | "excluded">;
  genreMode?: string[];
  topRange?: string;
}

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "views", label: "Views" },
  { id: "updated_at", label: "Updated" },
  { id: "created_at", label: "Created" },
  { id: "name", label: "Name A-Z" },
  { id: "rating", label: "Rating" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "all", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
];

export const GENRE_MODE_OPTIONS: Tag[] = [
  { id: "and", title: "AND" },
  { id: "or", title: "OR" },
];

export interface KaliCard {
  url: string;
  title: string;
  cover: string;
  latestChapter?: string;
  latestChapterUrl?: string;
  views?: string;
  rating?: string;
  genres: string[];
  summary?: string;
  updatedAt?: string;
  isAdult?: boolean;
}

export const GENRES: OptionItem[] = [
  { id: "action", value: "Action" },
  { id: "adaptation", value: "Adaptation" },
  { id: "adult", value: "Adult" },
  { id: "adventure", value: "Adventure" },
  { id: "animal", value: "Animal" },
  { id: "anthology", value: "Anthology" },
  { id: "cartoon", value: "Cartoon" },
  { id: "comedy", value: "Comedy" },
  { id: "comic", value: "Comic" },
  { id: "cooking", value: "Cooking" },
  { id: "demons", value: "Demons" },
  { id: "doujinshi", value: "Doujinshi" },
  { id: "drama", value: "Drama" },
  { id: "ecchi", value: "Ecchi" },
  { id: "fantasy", value: "Fantasy" },
  { id: "full-color", value: "Full Color" },
  { id: "game", value: "Game" },
  { id: "gender-bender", value: "Gender Bender" },
  { id: "ghosts", value: "Ghosts" },
  { id: "harem", value: "Harem" },
  { id: "historical", value: "Historical" },
  { id: "horror", value: "Horror" },
  { id: "isekai", value: "Isekai" },
  { id: "josei", value: "Josei" },
  { id: "long-strip", value: "Long Strip" },
  { id: "mafia", value: "Mafia" },
  { id: "magic", value: "Magic" },
  { id: "manga", value: "Manga" },
  { id: "manhua", value: "Manhua" },
  { id: "manhwa", value: "Manhwa" },
  { id: "martial-arts", value: "Martial Arts" },
  { id: "mature", value: "Mature" },
  { id: "mecha", value: "Mecha" },
  { id: "medical", value: "Medical" },
  { id: "military", value: "Military" },
  { id: "monster", value: "Monster" },
  { id: "monster-girls", value: "Monster Girls" },
  { id: "monsters", value: "Monsters" },
  { id: "music", value: "Music" },
  { id: "mystery", value: "Mystery" },
  { id: "office", value: "Office" },
  { id: "office-workers", value: "Office Workers" },
  { id: "one-shot", value: "One Shot" },
  { id: "police", value: "Police" },
  { id: "psychological", value: "Psychological" },
  { id: "reincarnation", value: "Reincarnation" },
  { id: "romance", value: "Romance" },
  { id: "school-life", value: "School Life" },
  { id: "sci-fi", value: "Sci-fi" },
  { id: "science-fiction", value: "Science Fiction" },
  { id: "seinen", value: "Seinen" },
  { id: "shoujo", value: "Shoujo" },
  { id: "shoujo-ai", value: "Shoujo Ai" },
  { id: "shounen", value: "Shounen" },
  { id: "shounen-ai", value: "Shounen Ai" },
  { id: "slice-of-life", value: "Slice of Life" },
  { id: "smut", value: "Smut" },
  { id: "soft-yaoi", value: "Soft Yaoi" },
  { id: "sports", value: "Sports" },
  { id: "super-power", value: "Super Power" },
  { id: "superhero", value: "Superhero" },
  { id: "supernatural", value: "Supernatural" },
  { id: "thriller", value: "Thriller" },
  { id: "time-travel", value: "Time Travel" },
  { id: "tragedy", value: "Tragedy" },
  { id: "vampire", value: "Vampire" },
  { id: "vampires", value: "Vampires" },
  { id: "video-games", value: "Video Games" },
  { id: "villainess", value: "Villainess" },
  { id: "web-comic", value: "Web Comic" },
  { id: "webtoons", value: "Webtoons" },
  { id: "yaoi", value: "Yaoi" },
  { id: "yuri", value: "Yuri" },
  { id: "zombies", value: "Zombies" },
];

export const ADULT_GENRES = [
  "adult",
  "smut",
  "ecchi",
  "mature",
  "yaoi",
  "soft yaoi",
  "yuri",
  "doujinshi",
];
