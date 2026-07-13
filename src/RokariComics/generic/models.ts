/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSection, SearchResultItem } from "@paperback/types";
import type { BasicAcceptedElems, Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

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

export type MangaStreamSearchMetadata = {
  page?: number;
};

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
