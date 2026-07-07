/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { GENRES, PAGE_DELAY_DEFAULT, PAGE_DELAY_KEY, type Option } from "../models";

// iOS swaps straight quotes for curly ones; the site only matches the straight
// forms, so normalize before searching.
export function straightenQuotes(value: string): string {
  return value.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
}

// Slug from a /manga/<slug> href (absolute or relative).
export function mangaIdFromHref(href: string): string {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  // Drop any query/fragment a pasted share link carries ("/manga/foo?utm=..",
  // "/manga/foo#comments") so the id stays the canonical slug.
  const after = (path.split("/manga/")[1] ?? "").split(/[?#]/)[0];
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

// ----- Genres -----

// The genre list shown in search and the blacklist. onisaga's taxonomy is a
// fixed set of ~90 genres (each with a stable numeric filter id), so we ship it
// as a curated constant exactly like the reference extension — rather than
// scraping the live browse/search filter, which also renders thousands of loose
// tags that clutter the picker, slow the screen, and overflow the state store.
export function getGenres(): Option[] {
  return GENRES;
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
