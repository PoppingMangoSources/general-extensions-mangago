/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SearchResultItem } from "@paperback/types";

import { formatListingSubtitle } from "../../../utils/listings";
import type { Medium, SeriesDetails, SeriesItem } from "../shared/models";
import {
  encodeMangaId,
  formatCoverUrl,
  formatSeriesType,
  toContentRating,
} from "../shared/parsers";
import type { TriState } from "./models";

export const pickTriState = (
  values: TriState | undefined,
  state: "included" | "excluded",
): string[] =>
  Object.entries(values ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => id);

export const toSearchResultItem = (
  series: SeriesItem,
  medium: Medium = series.medium === "novel" ? "novel" : "comic",
): SearchResultItem => {
  const subtitle = formatListingSubtitle({
    chapter: series.latest_chapter,
    chapterCount: series.chapter_count,
    type: formatSeriesType(series.type, medium),
  });
  return {
    mangaId: encodeMangaId(series.slug, medium),
    title: series.title,
    imageUrl: formatCoverUrl(series.cover_url),
    subtitle: subtitle || undefined,
    contentRating: toContentRating(series.is_nsfw),
  };
};

export const detailsToSearchResultItem = (
  series: SeriesDetails,
  medium: Medium = series.medium === "novel" ? "novel" : "comic",
): SearchResultItem => {
  const subtitle = formatListingSubtitle({
    chapterCount: series.chapter_count,
    type: formatSeriesType(series.type, medium),
  });
  return {
    mangaId: encodeMangaId(series.slug, medium),
    title: series.title,
    imageUrl: formatCoverUrl(series.cover_url),
    subtitle: subtitle || undefined,
    contentRating: toContentRating(series.is_nsfw),
  };
};
