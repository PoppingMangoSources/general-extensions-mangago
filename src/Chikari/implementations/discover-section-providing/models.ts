/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DiscoverSectionType, type DiscoverSection } from "@paperback/types";

import type { Period, SeriesType } from "../shared/models";

export const SECTIONS = {
  FEATURED: "featured",
  TRENDING: "trending",
  TRENDING_NOVELS: "trending-novels",
  RECENTLY_ADDED: "recently-added",
  RECENTLY_UPDATED: "recently-updated",
  RECENTLY_UPDATED_NOVELS: "recently-updated-novels",
  MOST_BOOKMARKED: "most-bookmarked",
  MOST_BOOKMARKED_NOVELS: "most-bookmarked-novels",
  POPULAR: "popular",
  TOP_RATED: "top-rated",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_SCHEMA_VERSION = 2;

export const NOVEL_SECTION_IDS: SectionId[] = [
  SECTIONS.TRENDING_NOVELS,
  SECTIONS.RECENTLY_UPDATED_NOVELS,
  SECTIONS.MOST_BOOKMARKED_NOVELS,
];

export const SECTION_DEFINITIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.FEATURED]: {
    id: SECTIONS.FEATURED,
    title: "Popular",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.TRENDING]: {
    id: SECTIONS.TRENDING,
    title: "Trending Comics",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.TRENDING_NOVELS]: {
    id: SECTIONS.TRENDING_NOVELS,
    title: "Trending Novels",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.RECENTLY_ADDED]: {
    id: SECTIONS.RECENTLY_ADDED,
    title: "Recently Added",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.RECENTLY_UPDATED]: {
    id: SECTIONS.RECENTLY_UPDATED,
    title: "Recently Updated Comics",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.RECENTLY_UPDATED_NOVELS]: {
    id: SECTIONS.RECENTLY_UPDATED_NOVELS,
    title: "Recently Updated Novels",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.MOST_BOOKMARKED]: {
    id: SECTIONS.MOST_BOOKMARKED,
    title: "Most Bookmarked Comics",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.MOST_BOOKMARKED_NOVELS]: {
    id: SECTIONS.MOST_BOOKMARKED_NOVELS,
    title: "Most Bookmarked Novels",
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
  { id: SECTIONS.TRENDING, title: "Trending Comics" },
  { id: SECTIONS.TRENDING_NOVELS, title: "Trending Novels" },
  { id: SECTIONS.RECENTLY_ADDED, title: "Recently Added" },
  { id: SECTIONS.RECENTLY_UPDATED, title: "Recently Updated Comics" },
  { id: SECTIONS.RECENTLY_UPDATED_NOVELS, title: "Recently Updated Novels" },
  { id: SECTIONS.MOST_BOOKMARKED, title: "Most Bookmarked Comics" },
  { id: SECTIONS.MOST_BOOKMARKED_NOVELS, title: "Most Bookmarked Novels" },
  { id: SECTIONS.POPULAR, title: "Popular by Type" },
  { id: SECTIONS.TOP_RATED, title: "Top Rated by Type" },
];

export const PERIOD_FILTERS: Array<{ id: Period; title: string }> = [
  { id: "day", title: "Today" },
  { id: "week", title: "Week" },
  { id: "month", title: "Month" },
];

export const BOOKMARK_PERIOD_FILTERS: Array<{ id: Period; title: string }> = PERIOD_FILTERS;

export const RECENTLY_ADDED_TYPE_FILTERS: TypeFilter[] = [
  { title: "Comics", types: ["manga", "manhwa", "manhua", "oel"] },
  { title: "Novels", types: ["novel"] },
];

export const TYPE_FILTERS: TypeFilter[] = [
  { title: "Manga", types: ["manga"] },
  { title: "Manhwa", types: ["manhwa"] },
  { title: "Manhua", types: ["manhua"] },
  { title: "Novel", types: ["novel"] },
];

export interface FilterItem {
  id: Period;
  title: string;
}

export interface TypeFilter {
  title: string;
  types: SeriesType[];
}
