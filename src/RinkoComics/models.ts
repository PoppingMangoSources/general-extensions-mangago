/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject } from "@paperback/types";

export const DOMAIN = "https://rinkocomics.com";

export const AJAX_ENDPOINT = `${DOMAIN}/wp-admin/admin-ajax.php`;

export const LOCK_SUFFIX = "#lock";

// Comic pages list chapters as `li.chapter`, novel detail pages as
// `div.chapter` rows, and reader sidebars as `a.chapter-item`.
export const CHAPTER_SELECTOR = "li.chapter, div.chapter, a.chapter-item";

export const SECTIONS = {
  HOT: "hot",
  PINNED: "pinned",
  LATEST: "latest",
  NOVELS: "novels",
  NOVEL_UPDATES: "novel-updates",
  GENRES: "genres",
} as const;

export const SORTING_OPTIONS = [
  { id: "updated", label: "Latest Update" },
  { id: "new", label: "Newest Series" },
  { id: "views", label: "Most Viewed" },
  { id: "az", label: "A-Z" },
];

export interface PageMetadata extends JSONObject {
  page?: number;
}

export interface SearchMetadata extends JSONObject {
  type?: string[];
  genres?: { [slug: string]: "included" | "excluded" };
}

export type ComicCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
};

export type Genre = {
  slug: string;
  name: string;
};

export type AjaxChapterResponse = {
  success?: boolean;
  data?: {
    html?: string;
  };
};
