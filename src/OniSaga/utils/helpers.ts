/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  GENRES,
  GENRES_FETCHED_KEY,
  GENRES_KEY,
  GENRES_TTL,
  PAGE_DELAY_DEFAULT,
  PAGE_DELAY_KEY,
  type Option,
} from "../models";

// iOS swaps straight quotes for curly ones; the site only matches the straight
// forms, so normalize before searching.
export function straightenQuotes(value: string): string {
  return value.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
}

// Slug from a /manga/<slug> href (absolute or relative).
export function mangaIdFromHref(href: string): string {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  const after = path.split("/manga/")[1] ?? "";
  return after.replace(/^\/+|\/+$/g, "");
}

// Root-relative path from a chapter href (used verbatim as the chapter id).
export function chapterIdFromHref(href: string): string {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  return path.startsWith("/") ? path : `/${path}`;
}

// The browse filter's release inputs are native date fields (YYYY-MM-DD).
// Accept a bare year for convenience ("2023" -> 2023-01-01 / 2023-12-31).
export function normalizeReleaseDate(value: string | undefined, isEnd: boolean): string | null {
  const raw = value?.trim() ?? "";
  if (/^\d{4}$/.test(raw)) return isEnd ? `${raw}-12-31` : `${raw}-01-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

export function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Failed to parse ${context}`, { cause: error });
  }
}

// ----- Genre cache -----

// The genre list shown in search, the Genres rail and the blacklist: the copy
// fetched from the site if present, otherwise the bundled fallback so the source
// works before the first fetch (or if it fails).
export function getGenres(): Option[] {
  const cached = Application.getState(GENRES_KEY) as Option[] | undefined;
  return cached && cached.length > 0 ? cached : GENRES;
}

export function cacheGenres(genres: Option[], now: number): void {
  Application.setState(genres, GENRES_KEY);
  Application.setState(now, GENRES_FETCHED_KEY);
}

// True when the cache is empty or older than the TTL, so it's worth refetching.
export function genresAreStale(now: number): boolean {
  const at = (Application.getState(GENRES_FETCHED_KEY) as number | undefined) ?? 0;
  return now - at > GENRES_TTL;
}

// ----- Reader pacing -----

// Stored option id for the reader's request spacing (see PAGE_DELAY_OPTIONS).
export function getPageDelayId(): string {
  return (Application.getState(PAGE_DELAY_KEY) as string | undefined) ?? PAGE_DELAY_DEFAULT;
}

// Seconds between reader page-API requests, from the user's setting.
export function getPageDelaySeconds(): number {
  const seconds = Number(getPageDelayId());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : Number(PAGE_DELAY_DEFAULT);
}
