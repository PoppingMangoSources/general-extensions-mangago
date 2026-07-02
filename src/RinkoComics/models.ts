/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://rinkocomics.com";

// Site AJAX endpoint used to lazily load the rest of the chapter list.
export const AJAX_ENDPOINT = `${DOMAIN}/wp-admin/admin-ajax.php`;

// Locked chapters are tagged with this suffix on their id so getChapterDetails
// can short-circuit before making a doomed request.
export const LOCK_SUFFIX = "#lock";
export const LOCK_PREFIX = "🔒 ";

// The site paginates the chapter list 10 at a time behind "load more".
export const CHAPTERS_PER_PAGE = 10;

export const CHAPTER_SELECTOR = "li.chapter";

// Extracts the nonce embedded in the inline ajax config object on the page.
export const NONCE_REGEX = /comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/;

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  // slug -> include/exclude. The site only filters on included genres; the
  // excluded state is kept for the tri-state selector but isn't sent.
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

// Shape of the admin-ajax `load_more_chapters` response.
export type AjaxChapterResponse = {
  success?: boolean;
  data?: {
    html?: string;
  };
};
