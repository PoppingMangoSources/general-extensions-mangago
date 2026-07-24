/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://kaliscan.io";

export const SECTIONS = {
  TOP_WEEK: "top-week",
  HOT: "hot-updates",
  LATEST: "latest",
  TRENDING: "trending",
  REVIEWS: "most-talked",
  MOST_VIEWED: "most-viewed",
  EDITORS: "editors",
  GENRES: "genres",
} as const;

export type OptionItem = {
  id: string;
  value: string;
};

export type PageMetadata = {
  page?: number;
  seen?: string[];
};

export type SearchMetadata = {
  status?: string[];
  author?: string;
  genres?: Record<string, "included" | "excluded">;
  genreMode?: string[];
};

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "views", label: "Views" },
  { id: "updated_at", label: "Updated" },
  { id: "created_at", label: "Created" },
  { id: "name", label: "Name A-Z" },
  { id: "total_chapters", label: "Chapters" },
  { id: "rating", label: "Rating" },
];

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "all", value: "All" },
  { id: "ongoing", value: "Ongoing" },
  { id: "completed", value: "Completed" },
];

export const GENRE_MODE_OPTIONS: OptionItem[] = [
  { id: "and", value: "AND" },
  { id: "or", value: "OR" },
];

export interface KaliCard {
  url: string;
  title: string;
  cover: string;
  latestChapter?: string;
  views?: string;
  rating?: string;
  genres: string[];
  summary?: string;
}

export interface KaliGridEntry {
  url: string;
  title: string;
  cover: string;
  rating?: string;
  updatedAt?: string;
  genres: string[];
  chapterName?: string;
  chapterUrl?: string;
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

export const ADULT_GENRES = ["adult", "smut", "ecchi", "mature", "yaoi", "soft yaoi", "yuri"];
