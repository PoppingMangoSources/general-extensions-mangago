/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  GENRE_OPTIONS,
  GENRE_TTL_SECONDS,
  GENRES_FETCH_KEY,
  GENRES_KEY,
  genreId,
  TAGS_QUERY,
  type TagsData,
} from "../models";
import { postGraphQL } from "../network";

// Read the cached genre list, falling back to the bundled defaults when the tag
// endpoint has never been reached — search and discover stay usable regardless.
export function getGenres(): string[] {
  const cached = Application.getState(GENRES_KEY) as string[] | undefined;
  return cached && cached.length > 0 ? cached : GENRE_OPTIONS;
}

// Map a genre id (see models.genreId) back to the API's display name, which the
// search endpoint filters on. Unknown ids pass through unchanged.
export function genreNameFromId(id: string): string {
  for (const name of getGenres()) {
    if (genreId(name) === id) return name;
  }
  return id;
}

// Refresh the cached genre list, forcing a fetch only when nothing is stored.
// Callers await this before building a form or genre section so the synchronous
// getGenres() reads a warm cache.
export async function checkGenres(): Promise<void> {
  const cached = Application.getState(GENRES_KEY) as string[] | undefined;
  await updateGenres(cached === undefined || cached.length === 0);
}

// Fetch-and-cache with a 48h TTL, mirroring the cache pattern used by other
// Inkdex sources: persist both the list and the fetch time to state (a plain
// variable would be dropped on reload) and only re-parse once the window ends.
export async function updateGenres(force: boolean): Promise<void> {
  const lastFetch = Number(Application.getState(GENRES_FETCH_KEY) ?? 0);
  const fresh = lastFetch + GENRE_TTL_SECONDS > new Date().valueOf() / 1000;
  if (fresh && !force) {
    // Cache still valid; only refetch if the persisted list went missing.
    if (Application.getState(GENRES_KEY) === undefined) await updateGenres(true);
    return;
  }

  try {
    const genres = await fetchGenres();
    if (genres.length > 0) {
      Application.setState(genres, GENRES_KEY);
      Application.setState(String(new Date().valueOf() / 1000), GENRES_FETCH_KEY);
    }
  } catch {
    // Leave the previous cache (or the bundled defaults) in place on failure.
  }
}

async function fetchGenres(): Promise<string[]> {
  const data = await postGraphQL<TagsData>(TAGS_QUERY, {});
  const names = (data.queryTags?.edges ?? [])
    .filter((edge) => (edge.mangaCount ?? 0) > 0)
    .map((edge) => edge.name.trim())
    .filter((name) => name.length > 0);
  // De-dupe and sort for a stable, browsable list.
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}