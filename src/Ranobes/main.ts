/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { RanobesAdvancedSearchForm } from "./forms/search";
import {
  DISCOVER_SECTIONS,
  DOMAIN,
  FILTER_TAXONOMY_STATE,
  PAGE_SIZE,
  SECTIONS,
  SORTING_OPTIONS,
  type FilterTaxonomy,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchChapterListPage, fetchListingPage, fetchPage, RanobesInterceptor } from "./network";
import {
  buildFilterPath,
  extractNovelId,
  hasNextPage,
  parseChapterDetails,
  parseChapterPage,
  parseChapters,
  parseFilterTaxonomy,
  parseLatestUpdates,
  parseListings,
  parseMangaDetails,
  parseSearchResults,
  toFeaturedItem,
  toRankingItem,
} from "./parsers";
import type RanobesConfig from "./pbconfig";

export class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 5,
    bufferInterval: 0.5,
    ignoreImages: true,
  });

  mainInterceptor = new RanobesInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  private taxonomyPromise?: Promise<FilterTaxonomy>;

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.taxonomyPromise = undefined;
    for (const cookie of cookies) {
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    switch (section.id) {
      case SECTIONS.FEATURED:
        return {
          items: parseListings(await fetchPage(`${DOMAIN}/`), "stories").map(toFeaturedItem),
        };
      case SECTIONS.LATEST: {
        const html = await fetchListingPage("/updates/", page);
        return {
          items: parseLatestUpdates(html),
          metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
        };
      }
      case SECTIONS.MOST_VIEWED:
        return this.getRankingItems("/ranking/", page, false);
      case SECTIONS.MOST_RATED:
        return this.getRankingItems("/ranking/rated/", page, true);
      case SECTIONS.ALL_TIME:
        return this.getRankingItems("/ranking/all_time/", page, false);
      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    this.taxonomyPromise ??= this.getFilterTaxonomy();
    return new RanobesAdvancedSearchForm(query, await this.taxonomyPromise);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = query.title.trim();
    const filterPath = buildFilterPath(title, query.metadata, sortingOption);
    const html = filterPath
      ? await fetchListingPage(filterPath, page)
      : await fetchListingPage("/novels/", page);
    return {
      items: parseSearchResults(html),
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const novelId = extractNovelId(sourceManga.mangaId);
    const firstPage = parseChapterPage(await fetchChapterListPage(novelId));
    const pageCount = Math.max(1, firstPage.pages_count ?? 1);
    const laterPages = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        fetchChapterListPage(novelId, index + 2).then(parseChapterPage),
      ),
    );
    return parseChapters([firstPage, ...laterPages], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(await fetchPage(chapter.chapterId), chapter);
  }

  private async getRankingItems(
    path: string,
    page: number,
    useRating: boolean,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchListingPage(path, page);
    return {
      items: parseListings(html, "rankings").map((card, index) =>
        toRankingItem(card, index + (page - 1) * PAGE_SIZE, useRating),
      ),
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  private async getFilterTaxonomy(): Promise<FilterTaxonomy> {
    const cached = Application.getState(FILTER_TAXONOMY_STATE) as FilterTaxonomy | undefined;
    if (cached?.events.length) return cached;
    const taxonomy = parseFilterTaxonomy(await fetchListingPage("/novels/"));
    Application.setState(taxonomy, FILTER_TAXONOMY_STATE);
    return taxonomy;
  }
}

export const Ranobes = new RanobesExtension();
