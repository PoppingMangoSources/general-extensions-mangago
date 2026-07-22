/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DiscoverSectionType, type DiscoverSection, type SortingOption } from "@paperback/types";

export const DOMAIN = "https://valirscans.org";

// Genre entries are wrapped as `{ genre: {...} }` in homepage payloads but
// flattened to `{ name, slug }` on series detail pages.
export interface ValirGenre {
  genre?: {
    slug?: string;
    name?: string;
  };
  slug?: string;
  name?: string;
}

export interface ValirChapterItem {
  number: number;
  title?: string | null;
  isLocked?: boolean;
  publishedAt?: string | null;
}

export interface ValirSeries {
  slug: string;
  urlSlug?: string;
  title: string;
  type?: string;
  coverImage?: string | null;
  bannerImage?: string | null;
  description?: string | null;
  status?: string | null;
  rating?: number;
  viewCount?: number;
  isMature?: boolean;
  author?: string | null;
  artist?: string | null;
  altTitle?: string | null;
  originalTitle?: string | null;
  aliases?: string[];
  genres?: ValirGenre[];
  tags?: { name?: string }[];
  chapters?: ValirChapterItem[];
  lastChapterAt?: string | null;
}

// Props of the series detail page component: the series record plus a
// paginated chapter list.
export interface ValirSeriesPage {
  series: ValirSeries;
  chapters?: ValirChapterItem[];
  totalPages?: number;
}

export interface ValirReaderPage {
  pageNumber: number;
  imageUrl: string;
}

export interface ValirChapterData {
  number?: number | string;
  title?: string;
  content?: string | null;
  pages?: ValirReaderPage[];
}

export interface HomeSections {
  featured: ValirSeries[];
  editorsPicks: ValirSeries[];
  latestUpdates: ValirSeries[];
  popularToday: ValirSeries[];
  mostPopular: ValirSeries[];
}

export type PageMetadata = { page: number };

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "updated", label: "Recently Updated" },
  { id: "popular", label: "Popular" },
  { id: "views", label: "Most Viewed" },
  { id: "newest", label: "Newest" },
];

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "featured", title: "Top Featured", type: DiscoverSectionType.featured },
  { id: "editors-picks", title: "Editors' Picks", type: DiscoverSectionType.prominentCarousel },
  { id: "latest-comics", title: "Latest Comic Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "latest-novels", title: "Latest Novel Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "popular-today", title: "Popular Today", type: DiscoverSectionType.prominentCarousel },
  { id: "most-popular", title: "Most Popular", type: DiscoverSectionType.simpleCarousel },
  { id: "new-series", title: "New Series", type: DiscoverSectionType.simpleCarousel },
];
