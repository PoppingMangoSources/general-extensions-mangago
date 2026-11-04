/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Tag } from "@paperback/types";

export const DOMAIN = "https://roliascan.com";

export interface PopularItem {
  cover: string;
  title: string;
  permalink: string;
  manga_type: string;
}

export interface LatestChapterEntry {
  title: string;
  manga_permalink: string;
  cover: string;
  chapter: string;
  last_3_chapters: { link: string }[] | null;
}

export interface BrowseEntry {
  title: string;
  url: string;
  cover: string;
  type: string;
  score: string;
  votes: number;
  description: string;
}

export interface SearchResultEntry {
  title: string;
  slug: string;
  permalink: string;
  thumbnail: string;
  type: string;
}

export interface FilterOptions {
  types: Tag[];
  statuses: Tag[];
  years: Tag[];
  genres: Tag[];
}

export type SearchMetadata = {
  genres?: string[];
  matchAllGenres?: boolean;
  type?: string;
  status?: string;
  year?: string;
};

export interface ChapterEntry {
  id: string;
  chapter: string;
  title: string;
  date: string;
  language: string;
}

export interface ChapterContentResponse {
  success: boolean;
  chapter_type: string;
  images?: string[];
  content?: string;
}
