/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSectionItem } from "@paperback/types";

import type { HomeResponse, HomeRow, SeriesItem, SeriesType, SortId } from "../shared/models";
import {
  chapterToken,
  formatChapterNumber,
  formatCoverUrl,
  formatRating,
  formatSeriesStatus,
  formatSeriesType,
  formatViews,
  sanitizeId,
  toContentRating,
} from "../shared/parsers";
import type { FilterItem } from "./models";

export const findHomeRow = (response: HomeResponse, slug: HomeRow["slug"]): SeriesItem[] =>
  response.rows.find((row) => row.slug === slug)?.items ?? [];

export const toFeaturedItem = (series: SeriesItem): DiscoverSectionItem => {
  const rating = formatRating(series.rating);
  return {
    type: "featuredCarouselItem",
    mangaId: sanitizeId(series.slug),
    imageUrl: formatCoverUrl(series.cover_url, 600),
    title: series.title,
    supertitle: formatSeriesType(series.type),
    summary: `${formatSeriesStatus(series.status)} • ${series.chapter_count} chapters`,
    infoItems: rating
      ? [
          { symbol: "star.fill", text: rating.replace("★ ", "") },
          { symbol: "eye.fill", text: formatViews(series.views) },
        ]
      : [{ symbol: "eye.fill", text: formatViews(series.views) }],
    contentRating: toContentRating(series.is_nsfw),
  };
};

export const toRecentlyAddedItem = (series: SeriesItem): DiscoverSectionItem => {
  const subtitle = [formatSeriesType(series.type), formatRating(series.rating)]
    .filter((value): value is string => Boolean(value))
    .join(" • ");
  return {
    type: "simpleCarouselItem",
    mangaId: sanitizeId(series.slug),
    imageUrl: formatCoverUrl(series.cover_url),
    title: series.title,
    subtitle: subtitle || undefined,
    contentRating: toContentRating(series.is_nsfw),
  };
};

export const toRecentlyUpdatedItem = (series: SeriesItem): DiscoverSectionItem | undefined => {
  if (series.latest_chapter == null) return undefined;
  const subtitle = [
    `Ch. ${formatChapterNumber(series.latest_chapter)}`,
    formatRating(series.rating),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");
  const date = series.last_chapter_at ? new Date(series.last_chapter_at) : undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: sanitizeId(series.slug),
    chapterId: chapterToken(series.latest_chapter),
    imageUrl: formatCoverUrl(series.cover_url, 200),
    title: series.title,
    subtitle: subtitle || undefined,
    publishDate: date && !Number.isNaN(date.getTime()) ? date : undefined,
    contentRating: toContentRating(series.is_nsfw),
  };
};

export const toPeriodFilterItems = (filters: FilterItem[], sort: SortId): DiscoverSectionItem[] =>
  filters.map((filter) => ({
    type: "genresCarouselItem",
    name: filter.title,
    searchQuery: {
      title: "",
      metadata: { sort, period: filter.id },
    },
  }));

export const toTypeFilterItems = (filters: FilterItem[], sort: SortId): DiscoverSectionItem[] =>
  filters.map((filter) => ({
    type: "genresCarouselItem",
    name: filter.title,
    searchQuery: {
      title: "",
      metadata: { sort, types: [filter.id as SeriesType] },
    },
  }));
