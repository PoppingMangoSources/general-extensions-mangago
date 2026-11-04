/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";
export const DOMAIN = "https://swarm.ws";
export const PAGE_SIZE = 50;
export const TYPE_LABELS: Record<string, string> = {
  manga: "Manga",
  manhwa: "Manhwa",
  manhua: "Manhua",
  novel: "Novel",
  oel: "OEL",
  doujinshi: "Doujinshi",
  artbook: "Artbook",
};
export const SECTIONS = {
  POPULAR: "popular",
  FOLLOWED: "followed",
  HOT: "hot",
  RANDOM: "random",
  NEW: "new",
  RECENT: "recent",
  NOVELS: "novels",
  GENRES: "genres",
} as const;
export const SORT_OPTIONS: SortingOption[] = [
  { id: "last_updated", label: "Recently Updated" },
  { id: "title", label: "Title A-Z" },
];
export const WINDOW_OPTIONS = [
  { id: "7d", title: "7 days" },
  { id: "1m", title: "1 month" },
  { id: "3m", title: "3 months" },
] as const;
export const CONTENT_OPTIONS: Tag[] = [
  { id: "safe", title: "Safe" },
  { id: "all", title: "All" },
  { id: "adult", title: "18+ only" },
];
export const LANGUAGE_OPTIONS: Tag[] = [
  { id: "en", title: "English" },
  { id: "es", title: "Spanish" },
  { id: "es-la", title: "Spanish (Latin America)" },
  { id: "pt-br", title: "Portuguese (Brazil)" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "it", title: "Italian" },
  { id: "ru", title: "Russian" },
  { id: "pl", title: "Polish" },
  { id: "ar", title: "Arabic" },
  { id: "id", title: "Indonesian" },
  { id: "vi", title: "Vietnamese" },
  { id: "tr", title: "Turkish" },
  { id: "th", title: "Thai" },
  { id: "ko", title: "Korean" },
  { id: "ja", title: "Japanese" },
  { id: "zh", title: "Chinese" },
  { id: "zh-hk", title: "Chinese (Hong Kong)" },
  { id: "pt", title: "Portuguese" },
  { id: "nl", title: "Dutch" },
  { id: "sv", title: "Swedish" },
  { id: "no", title: "Norwegian" },
  { id: "da", title: "Danish" },
  { id: "fi", title: "Finnish" },
  { id: "bn", title: "Bengali" },
  { id: "hi", title: "Hindi" },
  { id: "ur", title: "Urdu" },
  { id: "ms", title: "Malay" },
  { id: "he", title: "Hebrew" },
  { id: "uk", title: "Ukrainian" },
  { id: "bg", title: "Bulgarian" },
  { id: "ro", title: "Romanian" },
  { id: "hu", title: "Hungarian" },
  { id: "cs", title: "Czech" },
  { id: "sk", title: "Slovak" },
  { id: "hr", title: "Croatian" },
  { id: "sr", title: "Serbian" },
  { id: "sl", title: "Slovenian" },
  { id: "lt", title: "Lithuanian" },
  { id: "lv", title: "Latvian" },
  { id: "et", title: "Estonian" },
  { id: "el", title: "Greek" },
  { id: "ka", title: "Georgian" },
  { id: "hy", title: "Armenian" },
  { id: "az", title: "Azerbaijani" },
  { id: "kk", title: "Kazakh" },
  { id: "mn", title: "Mongolian" },
  { id: "my", title: "Burmese" },
  { id: "fa", title: "Persian" },
  { id: "pa", title: "Punjabi" },
  { id: "gu", title: "Gujarati" },
  { id: "te", title: "Telugu" },
  { id: "ta", title: "Tamil" },
  { id: "kn", title: "Kannada" },
  { id: "ml", title: "Malayalam" },
];
export const STATE_KEYS = {
  LANGUAGES: "swarm_languages",
  CONTENT: "swarm_content",
  CHAPTER_MODE: "swarm_chapter_mode",
  PREFERRED: "swarm_preferred",
  BLOCKED: "swarm_blocked",
} as const;
export interface Preferences {
  languages: string[];
  content: string;
  chapterMode: string;
  preferred: string[];
  blocked: string[];
}
export interface PageMetadata extends JSONObject {
  page: number;
}
export interface SearchMetadata extends JSONObject {
  catalog?: string[];
  genres?: string[];
  types?: string[];
  tags?: string[];
  content?: string[];
  yearStartMin?: string;
  yearStartMax?: string;
  yearEndedMin?: string;
  yearEndedMax?: string;
  minChapters?: string;
  feed?: string;
  window?: string;
}
export interface SwarmManga {
  id: string | number;
  title: string;
  url?: string;
  slug?: string;
  cover?: string;
  covers?: string[];
  description?: string;
  genres?: string[];
  tags?: string[];
  status?: string;
  type?: string;
  demographic?: string;
  author?: string;
  authors?: string[];
  artist?: string;
  artists?: string[];
  alt_titles?: string[];
  altTitles?: string[];
  availableLangs?: string[];
  nsfw?: boolean;
  suggestive?: boolean;
  views?: number | string;
  readCount?: number;
  bookmark_count?: number;
  chapterCount?: number;
  chapter_count?: number;
  latestChapterNumber?: number | string | null;
  latest_chapter_number?: number | string | null;
  latestChapter?: string;
  chapter?: string;
  number?: string;
  chapter_id?: string;
  lang?: string;
  released?: string;
  updatedAt?: string;
  lastUpdated?: string;
  createdAt?: string;
  year?: number;
  _count?: { chapters: number };
  chapters?: SwarmChapter[];
}
export interface SwarmChapter {
  id: string | number;
  number: string | number;
  lang?: string;
  title?: string;
  rank?: string | null;
  source_name?: string;
  source?: string;
  scan_group?: string;
  published_date?: string;
  createdAt?: string;
  isLocked?: boolean;
}
export interface MangaListResponse {
  data: SwarmManga[];
  total?: number;
  hasMore?: boolean;
  limit?: number;
  offset?: number;
}
export interface HomepageResponse {
  popular: MangaListResponse;
  newComics: MangaListResponse;
}
export interface ComicPage {
  manga: SwarmManga;
  chapters: SwarmChapter[];
}
export interface NovelResponse {
  success: boolean;
  data: SwarmManga;
}
export interface NovelChapterResponse {
  success: boolean;
  data: { id: number; number: number; title: string; content: string };
}
export interface PagesResponse {
  chapter?: { data?: string[] };
  error?: string;
}
