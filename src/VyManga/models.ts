/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// VyManga (vymanga.com) is a custom manga aggregator scraped from its HTML.
// Browse/search all run through `/search` with rich query parameters.

export const DEFAULT_DOMAIN = "https://vymanga.com";
export const SEARCH_PATH = "search";

// Listing/discover cards (browse, search and the homepage widgets share these).
export const CARD_SELECTOR = ".comic-item";
export const CARD_LINK_SELECTOR = "a";
export const CARD_TITLE_SELECTOR = ".comic-title";
export const CARD_IMAGE_SELECTOR = ".comic-image img, img.image, img.lozad";
export const CARD_LATEST_SELECTOR = ".comic-image > span, .comic-image span";
export const NEXT_PAGE_SELECTOR = "[rel=next]";

// Details page.
export const TITLE_SELECTOR = "h1";
export const THUMB_SELECTOR = ".img-manga img, .content-thumb img";
export const DESC_SELECTOR = ".summary > .content, div.summary p.content";
export const AUTHOR_SELECTOR = ".pre-title:contains(Author) ~ a";
export const ARTIST_SELECTOR = ".pre-title:contains(Artist) ~ a";
export const GENRE_SELECTOR = ".pre-title:contains(Genres) ~ a, div.col-md-7 p a[href*=genre]";
export const STATUS_SELECTOR =
  ".pre-title:contains(Status) ~ span:not(.space), div.col-md-7 p:contains(Status) span";
export const RATING_SELECTOR = ".pre-title:contains(Rating), div.col-md-7 p:contains(Rating)";

// Chapter list + reader. Multi-chapter titles list each chapter as an
// a.list-chapter; single-chapter titles only expose an anchor with an id like
// "chapter-123", used as a fallback so the "First/New Chapter" shortcut buttons
// (which share those ids) don't duplicate the list on multi-chapter pages.
export const CHAPTER_SELECTOR = "a.list-chapter";
export const CHAPTER_FALLBACK_SELECTOR = 'a[id^="chapter-"]';
export const CHAPTER_DATE_SELECTOR = "p.small";
// The reader renders pages inside div.carousel-item[data-page]; img.lozad /
// img.d-block are older layouts kept as fallbacks.
export const PAGE_SELECTOR = "div.carousel-item[data-page] img, img.lozad, img.d-block";

// Genre links live in the site-wide navigation (`/genre/<slug>`), so they can be
// scraped from any page and stay consistent with the slug ids used by the
// details-page tags and the `genre[]` search parameter.
export const GENRE_LINK_SELECTOR = 'a[href*="/genre/"]';

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  author?: string;
  // search_po / author_po: 0 = contains, 1 = begins with, 2 = ends with.
  searchType?: string[];
  authorType?: string[];
  searchDescription?: boolean;
  // completed: "0" ongoing, "1" completed, "" all.
  status?: string[];
  // viewed / scored / created_at / updated_at.
  sort?: string[];
  // desc / asc.
  order?: string[];
  genres?: Record<string, "included" | "excluded">;
};

export type OptionItem = {
  id: string;
  value: string;
};

// A parsed manga card from a listing/discover widget.
export type MangaCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
  subtitle?: string;
};

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "", value: "All" },
  { id: "0", value: "Ongoing" },
  { id: "1", value: "Completed" },
];

export const SORT_OPTIONS: OptionItem[] = [
  { id: "viewed", value: "Most Viewed" },
  { id: "scored", value: "Top Rated" },
  { id: "created_at", value: "Newest" },
  { id: "updated_at", value: "Latest Update" },
];

export const ORDER_OPTIONS: OptionItem[] = [
  { id: "desc", value: "Descending" },
  { id: "asc", value: "Ascending" },
];

export const SEARCH_TYPE_OPTIONS: OptionItem[] = [
  { id: "0", value: "Contains" },
  { id: "1", value: "Begins with" },
  { id: "2", value: "Ends with" },
];

// Genres that mark a title as adult. Matched case-insensitively against genre
// display names so the details page can report ContentRating.ADULT.
export const ADULT_GENRE_NAMES: ReadonlySet<string> = new Set([
  "adult",
  "mature",
  "smut",
  "ecchi",
  "hentai",
  "erotica",
  "pornographic",
  "18+",
  "nsfw",
]);
