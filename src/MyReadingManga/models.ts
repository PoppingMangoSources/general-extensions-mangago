/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
} from "@paperback/types";

export const DOMAIN = "https://myreadingmanga.info";

export interface MangaCard {
  mangaId: string;
  title: string;
  imageUrl: string;
}

export interface FilterOption {
  id: string;
  title: string;
}

// One entry per Easy-Post filter widget in the site's search sidebar.
export type FilterTaxonomies = Record<string, FilterOption[]>;

export type PageMetadata = { page: number };

export interface SearchMetadata extends JSONObject {
  genre?: string;
  category?: string;
  tag?: string;
  artist?: string;
  pairing?: string;
  status?: string;
  language?: string;
}

// Site languages: the display name is what `ep_filter_lang` accepts, the
// class is how listing cards are tagged, and the code is the ISO langCode.
export const LANGUAGES = [
  { code: "en", name: "English", class: "english" },
  { code: "ja", name: "Japanese", class: "jp" },
  { code: "zh", name: "Chinese", class: "chinese" },
  { code: "ko", name: "Korean", class: "korean" },
  { code: "es", name: "Spanish", class: "spanish" },
  { code: "fr", name: "French", class: "french" },
  { code: "de", name: "German", class: "german" },
  { code: "it", name: "Italian", class: "italian" },
  { code: "pt", name: "Portuguese", class: "portuguese" },
];

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "date", label: "Newest" },
  { id: "date_asc", label: "Oldest" },
  { id: "relevance", label: "Relevance" },
  { id: "rand", label: "Random" },
];

// Listing paths mirror the site's browse entries; all paginate via /page/N/.
export const LISTING_PATHS: Record<string, string> = {
  latest: "/",
  popular: "/popular/",
  manga: "/yaoi-manga/",
  bara: "/genre/bara/",
  random: "/?ep_sort=rand&s=",
};

export const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "latest", title: "Latest", type: DiscoverSectionType.simpleCarousel },
  { id: "manga", title: "Manga", type: DiscoverSectionType.simpleCarousel },
  { id: "bara", title: "Bara", type: DiscoverSectionType.simpleCarousel },
  { id: "random", title: "Random", type: DiscoverSectionType.simpleCarousel },
  { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
];
