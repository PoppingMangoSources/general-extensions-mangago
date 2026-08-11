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
import {
  fetchNovelDetails,
  fetchNovels,
  fetchSeries,
  fetchSeriesDetails,
} from "../../services/network";
import { getPreferences } from "../settings-form-providing/main";
import { PAGE_SIZE, type PageMetadata, type SeriesType, type SortId } from "../shared/models";
import { ChikariAdvancedSearchForm } from "./forms";
import { DEFAULT_SEARCH_TYPES, SORT_OPTIONS, type SearchMetadata } from "./models";
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
    return new ChikariAdvancedSearchForm(query, genres, tags);
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
      types: DEFAULT_SEARCH_TYPES,
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
    const minimum = Number(searchMetadata.minChapters);
    const selectedTypes = (searchMetadata.types ?? DEFAULT_SEARCH_TYPES) as SeriesType[];
    const comicTypes = selectedTypes.filter((type) => type !== "novel");
    const includeNovels = selectedTypes.includes("novel");
    const includeComics = comicTypes.length > 0;
    const limit = includeComics && includeNovels ? Math.floor(PAGE_SIZE / 2) : PAGE_SIZE;
    const comicOffset = metadata?.offset ?? 0;
    const novelOffset = metadata?.novelOffset ?? 0;
    const options = {
      adult: preferences.adult,
      excludedGenres,
      excludedTags,
      genres: includedGenres,
      limit,
      minChapters:
        searchMetadata.minChapters && Number.isFinite(minimum) ? Math.max(0, minimum) : undefined,
      period: searchMetadata.period,
      query: query.title.trim() || undefined,
      sort: searchMetadata.sort ?? (sortingOption?.id as SortId | undefined) ?? "popular",
      statuses: searchMetadata.statuses,
      tags: includedTags,
      years: searchMetadata.year ? [searchMetadata.year] : [],
    };
    const [comicData, novelData] = await Promise.all([
      includeComics
        ? fetchSeries({
            ...options,
            contentRatings: preferences.contentRatings,
            offset: comicOffset,
            types: comicTypes,
          })
        : undefined,
      includeNovels ? fetchNovels({ ...options, offset: novelOffset }) : undefined,
    ]);

    const nextComicOffset = comicOffset + (comicData?.items.length ?? 0);
    const nextNovelOffset = novelOffset + (novelData?.items.length ?? 0);
    const hasMoreComics = Boolean(
      comicData && comicData.items.length > 0 && nextComicOffset < comicData.total,
    );
    const hasMoreNovels = Boolean(
      novelData && novelData.items.length > 0 && nextNovelOffset < novelData.total,
    );
    return {
      items: [
        ...(comicData?.items.map((series) => toSearchResultItem(series, "comic")) ?? []),
        ...(novelData?.items.map((series) => toSearchResultItem(series, "novel")) ?? []),
      ],
      metadata:
        hasMoreComics || hasMoreNovels
          ? { offset: nextComicOffset, novelOffset: nextNovelOffset }
          : undefined,
    };
  }

  async resolveUrlQuery(query: string): Promise<PagedResults<SearchResultItem> | undefined> {
    const match = query
      .trim()
      .match(/^https?:\/\/(?:www\.)?chikari\.moe\/(series|novels)\/([^/?#]+)/i);
    if (!match?.[1] || !match[2]) return undefined;

    let slug: string;
    try {
      slug = decodeURIComponent(match[2]);
    } catch {
      return undefined;
    }

    try {
      const medium = match[1].toLowerCase() === "novels" ? "novel" : "comic";
      const details =
        medium === "novel" ? await fetchNovelDetails(slug) : await fetchSeriesDetails(slug);
      return { items: [detailsToSearchResultItem(details, medium)] };
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }
}
