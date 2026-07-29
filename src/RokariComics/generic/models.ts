/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  ContentRating,
  DiscoverSection,
  JSONObject,
  SearchResultItem,
} from "@paperback/types";
import type { BasicAcceptedElems, Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

export const SEARCH_TAGS_KEY = "rokaricomics_search_tags";

export interface Months {
  january: string;
  february: string;
  march: string;
  april: string;
  may: string;
  june: string;
  july: string;
  august: string;
  september: string;
  october: string;
  november: string;
  december: string;
}

export interface StatusTypes {
  ONGOING: string;
  COMPLETED: string;
}

export interface MangaStreamParserContext {
  contentRating: ContentRating;
  dateMonths: Months;
  language: string;
  mangaSelectorAlternativeTitles: string;
  mangaSelectorArtist: string;
  mangaSelectorAuthor: string;
  mangaSelectorStatus: string;
  mangaStatusTypes: StatusTypes;
  mangaTagSelectorBox: string;
  slugToPostId(slug: string, path: string): Promise<string>;
}

export interface MangaStreamSearchMetadata extends JSONObject {
  page?: number;
}

export interface MangaStreamFilterMetadata extends JSONObject {
  genres?: Record<string, "included" | "excluded">;
  status?: Record<string, "included" | "excluded">;
  type?: Record<string, "included" | "excluded">;
  order?: Record<string, "included" | "excluded">;
  rokariRange?: string;
}

export interface MangaStreamSearchResultItem extends SearchResultItem {
  path: string;
}

export interface MangaStreamSlug {
  slug: string;
  path: string;
}

export interface MangaStreamDiscoverSection extends DiscoverSection {
  selectorFunc($: CheerioAPI): Cheerio<BasicAcceptedElems<AnyNode>>;
  titleSelectorFunc($: CheerioAPI, element: BasicAcceptedElems<AnyNode>): string;
  subtitleSelectorFunc($: CheerioAPI, element: BasicAcceptedElems<AnyNode>): string;
  itemType:
    | "featuredCarouselItem"
    | "simpleCarouselItem"
    | "prominentCarouselItem"
    | "chapterUpdatesCarouselItem"
    | "genresCarouselItem";
  enabled: boolean;
}
