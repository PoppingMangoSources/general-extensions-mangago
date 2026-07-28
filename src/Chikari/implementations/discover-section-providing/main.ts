/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  DiscoverSection,
  DiscoverSectionItem,
  Metadata,
  PagedResults,
} from "@paperback/types";

import type { ChikariImplementation } from "../../main";
import { getSectionOrder, getVisibleSections } from "../settings-form-providing/main";
import {
  BOOKMARK_PERIOD_FILTERS,
  PERIOD_FILTERS,
  SECTIONS,
  SECTION_DEFINITIONS,
  TYPE_FILTERS,
} from "./models";
import {
  findHomeRow,
  toFeaturedItem,
  toPeriodFilterItems,
  toRecentlyAddedItem,
  toRecentlyUpdatedItem,
  toTypeFilterItems,
} from "./parsers";

export class DiscoverProvider {
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const visible = new Set(getVisibleSections());
    return getSectionOrder()
      .filter((id) => visible.has(id))
      .map((id) => SECTION_DEFINITIONS[id]);
  }

  async getDiscoverSectionItems(
    this: ChikariImplementation,
    section: DiscoverSection,
    _metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED:
        return this.getFeaturedSection();
      case SECTIONS.TRENDING:
        return this.getTrendingSection();
      case SECTIONS.RECENTLY_ADDED:
        return this.getRecentlyAddedSection();
      case SECTIONS.RECENTLY_UPDATED:
        return this.getRecentlyUpdatedSection();
      case SECTIONS.MOST_BOOKMARKED:
        return this.getMostBookmarkedSection();
      case SECTIONS.POPULAR:
        return this.getPopularSection();
      case SECTIONS.TOP_RATED:
        return this.getTopRatedSection();
      default:
        return { items: [] };
    }
  }

  async getFeaturedSection(
    this: ChikariImplementation,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: findHomeRow(await this.getHomeData(), "popular").map(toFeaturedItem),
    };
  }

  async getTrendingSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return { items: toPeriodFilterItems(PERIOD_FILTERS, "trending") };
  }

  async getRecentlyAddedSection(
    this: ChikariImplementation,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: findHomeRow(await this.getHomeData(), "recently-added").map(toRecentlyAddedItem),
    };
  }

  async getRecentlyUpdatedSection(
    this: ChikariImplementation,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: findHomeRow(await this.getHomeData(), "recently-updated").flatMap((series) => {
        const item = toRecentlyUpdatedItem(series);
        return item ? [item] : [];
      }),
    };
  }

  async getMostBookmarkedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: toPeriodFilterItems(BOOKMARK_PERIOD_FILTERS, "most_bookmarked"),
    };
  }

  async getPopularSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return { items: toTypeFilterItems(TYPE_FILTERS, "popular") };
  }

  async getTopRatedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return { items: toTypeFilterItems(TYPE_FILTERS, "top_rated") };
  }
}
