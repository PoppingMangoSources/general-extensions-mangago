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
  manga_id: string;
  title: string;
  permalink: string;
  manga_permalink: string;
  cover: string;
  chapter: string;
  time: string;
  manga_type: string;
  manga_status: string;
  last_3_chapters: {
    title: string;
    chapter: string;
    link: string;
    time: string;
    is_new: boolean;
  }[];
}

export interface BrowseEntry {
  id: string;
  title: string;
  url: string;
  cover: string;
  score: string;
  votes: number;
  status: string;
  year: string;
  type: string;
  description: string;
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
  chapter_type: string;
  group_id: string | null;
  language: string;
  group_name: string | null;
  likes: string;
  url: string;
}

export interface ChapterContentResponse {
  success: boolean;
  chapter_id: number;
  chapter_type: string;
  images: string[];
  total: number;
}
