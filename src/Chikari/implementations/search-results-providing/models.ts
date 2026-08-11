/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption } from "@paperback/types";

import type { Period, SeriesStatus, SeriesType, SortId } from "../shared/models";

export type TriState = Record<string, "included" | "excluded">;

export interface SearchMetadata extends JSONObject {
  genres?: TriState;
  minChapters?: string;
  period?: Period;
  sort?: SortId;
  statuses?: SeriesStatus[];
  tags?: TriState;
  types?: SeriesType[];
  year?: string;
}

export const DEFAULT_SEARCH_TYPES: SeriesType[] = ["manga", "manhwa", "manhua", "novel"];

export const SORT_OPTIONS: SortingOption[] = [
  { id: "popular", label: "Popularity" },
  { id: "top_rated", label: "Top Rated" },
  { id: "trending", label: "Trending" },
  { id: "updated", label: "Recently Updated" },
  { id: "added", label: "Recently Added" },
  { id: "most_bookmarked", label: "Most Bookmarked" },
];

export const TYPE_OPTIONS: Array<{ id: SeriesType; title: string }> = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "oel", title: "OEL" },
  { id: "novel", title: "Novel" },
];

export const STATUS_OPTIONS: Array<{ id: SeriesStatus; title: string }> = [
  { id: "releasing", title: "Releasing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
  { id: "upcoming", title: "Upcoming" },
];
