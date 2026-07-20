/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating } from "@paperback/types";

import { getContentPreference, getHiddenGenreIds } from "../forms/settings";
import {
  ADULT_TAG_IDS,
  MATURE_TAG_IDS,
  type SearchMetadata,
  type SeriesDto,
  type TriStateSelection,
  type TriStateValue,
} from "../models";
import { deriveContentRating } from "../parsers";

export interface ContentFilters {
  allowAllContent: boolean;
  hiddenGenreIds: Set<number>;
}

export function getContentFilters(): ContentFilters {
  return {
    allowAllContent: getContentPreference() === "all",
    hiddenGenreIds: new Set(getHiddenGenreIds().map(Number)),
  };
}

export function getSelectedIds(
  selection: TriStateSelection | undefined,
  state: TriStateValue,
): string[] {
  return Object.entries(selection ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => id);
}

export function isGenreVisible(tagId: string, filters: ContentFilters): boolean {
  const numericId = Number(tagId);
  if (filters.hiddenGenreIds.has(numericId)) return false;
  if (filters.allowAllContent) return true;
  return !ADULT_TAG_IDS.has(numericId) && !MATURE_TAG_IDS.has(numericId);
}

export function seriesMatchesFilters(
  series: SeriesDto,
  metadata: SearchMetadata | undefined,
  filters: ContentFilters,
): boolean {
  if (!filters.allowAllContent && deriveContentRating(series) !== ContentRating.EVERYONE) {
    return false;
  }

  const tags = new Set(series.tags ?? []);
  if ([...filters.hiddenGenreIds].some((id) => tags.has(id))) return false;
  if (!matchesSingleValue(series.type, metadata?.types)) return false;
  if (!matchesSingleValue(series.status, metadata?.statuses)) return false;
  return matchesTags(tags, metadata);
}

function matchesSingleValue(
  value: number | null | undefined,
  selection: TriStateSelection | undefined,
): boolean {
  const id = value == null ? undefined : String(value);
  const included = getSelectedIds(selection, "included");
  const excluded = new Set(getSelectedIds(selection, "excluded"));
  if (id !== undefined && excluded.has(id)) return false;
  return included.length === 0 || (id !== undefined && included.includes(id));
}

function matchesTags(tags: Set<number>, metadata: SearchMetadata | undefined): boolean {
  const included = getSelectedIds(metadata?.tags, "included").map(Number);
  const excluded = getSelectedIds(metadata?.tags, "excluded").map(Number);

  if (excluded.some((id) => tags.has(id))) return false;
  if (included.length === 0) return true;
  return metadata?.tagMatchMode === "or"
    ? included.some((id) => tags.has(id))
    : included.every((id) => tags.has(id));
}
