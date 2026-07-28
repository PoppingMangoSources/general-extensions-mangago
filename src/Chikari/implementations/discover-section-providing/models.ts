/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DiscoverSectionType, type DiscoverSection } from "@paperback/types";

import type { Period, SeriesType } from "../shared/models";

export const SECTIONS = {
  FEATURED: "featured",
  TRENDING: "trending",
  RECENTLY_ADDED: "recently-added",
  RECENTLY_UPDATED: "recently-updated",
  MOST_BOOKMARKED: "most-bookmarked",
  POPULAR: "popular",
  TOP_RATED: "top-rated",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.FEATURED]: {
    id: SECTIONS.FEATURED,
    title: "Popular",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.TRENDING]: {
    id: SECTIONS.TRENDING,
    title: "Trending",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.RECENTLY_ADDED]: {
    id: SECTIONS.RECENTLY_ADDED,
    title: "Recently Added",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.RECENTLY_UPDATED]: {
    id: SECTIONS.RECENTLY_UPDATED,
    title: "Recently Updated",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.MOST_BOOKMARKED]: {
    id: SECTIONS.MOST_BOOKMARKED,
    title: "Most Bookmarked",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.POPULAR]: {
    id: SECTIONS.POPULAR,
    title: "Popular by Type",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.TOP_RATED]: {
    id: SECTIONS.TOP_RATED,
    title: "Top Rated by Type",
    type: DiscoverSectionType.genres,
  },
};

export const SECTION_OPTIONS: Array<{ id: SectionId; title: string }> = [
  { id: SECTIONS.FEATURED, title: "Popular" },
  { id: SECTIONS.TRENDING, title: "Trending" },
  { id: SECTIONS.RECENTLY_ADDED, title: "Recently Added" },
  { id: SECTIONS.RECENTLY_UPDATED, title: "Recently Updated" },
  { id: SECTIONS.MOST_BOOKMARKED, title: "Most Bookmarked" },
  { id: SECTIONS.POPULAR, title: "Popular by Type" },
  { id: SECTIONS.TOP_RATED, title: "Top Rated by Type" },
];

export const PERIOD_FILTERS: Array<{ id: Period; title: string }> = [
  { id: "day", title: "Today" },
  { id: "week", title: "Week" },
  { id: "month", title: "Month" },
];

export const BOOKMARK_PERIOD_FILTERS: Array<{ id: Period; title: string }> = [
  ...PERIOD_FILTERS,
  { id: "all", title: "All Time" },
];

export const TYPE_FILTERS: Array<{ id: SeriesType; title: string }> = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
];

export interface FilterItem {
  id: Period | SeriesType;
  title: string;
}
