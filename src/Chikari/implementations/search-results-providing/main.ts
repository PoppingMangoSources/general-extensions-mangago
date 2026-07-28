/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  type AdvancedSearchForm,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
} from "@paperback/types";

import type { ChikariImplementation } from "../../main";
import { fetchSeries, fetchSeriesDetails } from "../../services/network";
import { getPreferences } from "../settings-form-providing/main";
import type { PageMetadata, SeriesType, SortId } from "../shared/models";
import { ChikariAdvancedSearchForm } from "./forms";
import { SORT_OPTIONS, type SearchMetadata } from "./models";
import { detailsToSearchResultItem, pickTriState, toSearchResultItem } from "./parsers";

export class SearchProvider {
  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(
    this: ChikariImplementation,
    query: SearchQuery<SearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    const [genres, tags] = await Promise.all([this.getGenreOptions(), this.getTagOptions()]);
    return new ChikariAdvancedSearchForm(query, getPreferences(), genres, tags);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title);
    if (pasted) return pasted;

    const preferences = getPreferences();
    const searchMetadata = {
      genres: {},
      minChapters: "",
      statuses: [],
      tags: {},
      types: preferences.types,
      year: "",
      ...query.metadata,
    };
    const includedGenres = pickTriState(searchMetadata.genres, "included");
    const includedTags = pickTriState(searchMetadata.tags, "included");
    const excludedGenres = [
      ...new Set([
        ...preferences.excludedGenres.filter((genre) => !includedGenres.includes(genre)),
        ...pickTriState(searchMetadata.genres, "excluded"),
      ]),
    ];
    const excludedTags = [
      ...new Set([
        ...preferences.excludedTags.filter((tag) => !includedTags.includes(tag)),
        ...pickTriState(searchMetadata.tags, "excluded"),
      ]),
    ];
    const offset = metadata?.offset ?? 0;
    const minimum = Number(searchMetadata.minChapters);
    const data = await fetchSeries({
      adult: preferences.adult,
      contentRatings: preferences.contentRatings,
      excludedGenres,
      excludedTags,
      genres: includedGenres,
      minChapters:
        searchMetadata.minChapters && Number.isFinite(minimum) ? Math.max(0, minimum) : undefined,
      offset,
      period: searchMetadata.period,
      query: query.title.trim() || undefined,
      sort: searchMetadata.sort ?? (sortingOption?.id as SortId | undefined) ?? "popular",
      statuses: searchMetadata.statuses,
      tags: includedTags,
      types: searchMetadata.types as SeriesType[],
      years: searchMetadata.year ? [searchMetadata.year] : [],
    });

    const nextOffset = offset + data.items.length;
    return {
      items: data.items.map(toSearchResultItem),
      metadata:
        nextOffset < data.total && data.items.length > 0 ? { offset: nextOffset } : undefined,
    };
  }

  async resolveUrlQuery(query: string): Promise<PagedResults<SearchResultItem> | undefined> {
    const match = query.trim().match(/^https?:\/\/(?:www\.)?chikari\.moe\/series\/([^/?#]+)/i);
    if (!match?.[1]) return undefined;

    let slug: string;
    try {
      slug = decodeURIComponent(match[1]);
    } catch {
      return undefined;
    }

    try {
      return { items: [detailsToSearchResultItem(await fetchSeriesDetails(slug))] };
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }
}
