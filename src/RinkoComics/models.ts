/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://rinkocomics.com";

export const AJAX_ENDPOINT = `${DOMAIN}/wp-admin/admin-ajax.php`;

export const LOCK_SUFFIX = "#lock";
export const LOCK_PREFIX = "🔒 ";

export const CHAPTERS_PER_PAGE = 10;

// Comic pages list chapters as `li.chapter`, novel detail pages as
// `div.chapter` rows, and reader sidebars as `a.chapter-item`.
export const CHAPTER_SELECTOR = "li.chapter, div.chapter, a.chapter-item";

export const SORTING_OPTIONS = [
  { id: "newest", label: "Newest First" },
  { id: "oldest", label: "Oldest First" },
  { id: "az", label: "A-Z" },
  { id: "za", label: "Z-A" },
];

export const NONCE_REGEX = /comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/;

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  genres?: { [slug: string]: "included" | "excluded" };
};

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
