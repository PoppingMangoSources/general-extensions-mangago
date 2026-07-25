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
  type Form,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { ValirScansAdvancedSearchForm } from "./forms/search";
import { getShowPaidChapters, ValirScansSettingsForm } from "./forms/settings";
import {
  DISCOVER_SECTIONS,
  GENRES,
  SECTIONS,
  SORTING_OPTIONS,
  type FilterTaxonomy,
  type HomeSections,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchBrowsePage,
  fetchChapterPage,
  fetchHomePage,
  fetchSeriesPage,
  ValirScansInterceptor,
} from "./network";
import {
  parseBrowsePage,
  parseChapterDetails,
  parseChapters,
  parseFilterTaxonomy,
  parseHomeSections,
  parseMangaDetails,
  parseSeriesPage,
  toCarouselItems,
  toChapterUpdateItems,
  toFeaturedItems,
  toSearchResultItem,
} from "./parsers";
import type ValirScansConfig from "./pbconfig";

export class ValirScansExtension implements ExtensionImpl<typeof ValirScansConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 4,
    bufferInterval: 1,
    ignoreImages: true,
  });

  mainInterceptor = new ValirScansInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  private homePromise?: Promise<HomeSections>;

  // Genre/tag taxonomy for the advanced search form, fetched once per session.
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
    this.homePromise = undefined;
    this.taxonomyPromise = undefined;
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  async getSettingsForm(): Promise<Form> {
    return new ValirScansSettingsForm();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const seriesPage = parseSeriesPage(await fetchSeriesPage(mangaId));
    return parseMangaDetails(seriesPage, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const firstPage = parseSeriesPage(await fetchSeriesPage(sourceManga.mangaId));
    const laterPages = await Promise.all(
      Array.from({ length: (firstPage.totalPages ?? 1) - 1 }, (_, index) =>
        fetchSeriesPage(sourceManga.mangaId, index + 2).then(parseSeriesPage),
      ),
    );
    return parseChapters([firstPage, ...laterPages], sourceManga, getShowPaidChapters());
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await fetchChapterPage(chapter.sourceManga.mangaId, chapter.chapterId);
    return parseChapterDetails(html, chapter);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.NEW_SERIES) {
      const page = metadata?.page ?? 1;
      const browse = parseBrowsePage(await fetchBrowsePage(page, undefined, "newest"));
      return {
        items: toCarouselItems(browse.series, "simpleCarouselItem"),
        metadata: browse.hasMore ? { page: page + 1 } : undefined,
      };
    }

    const home = await this.getHomeSections();
    switch (section.id) {
      case SECTIONS.FEATURED:
        return { items: toFeaturedItems(home.featured) };
      case SECTIONS.EDITORS_PICKS:
        return { items: toCarouselItems(home.editorsPicks, "prominentCarouselItem") };
      case SECTIONS.LATEST_COMICS:
        return { items: toChapterUpdateItems(home.latestUpdates, false) };
      case SECTIONS.LATEST_NOVELS:
        return { items: toChapterUpdateItems(home.latestUpdates, true) };
      case SECTIONS.POPULAR_TODAY:
        return { items: toCarouselItems(home.popularToday, "prominentCarouselItem", true) };
      case SECTIONS.MOST_POPULAR:
        return { items: toCarouselItems(home.mostPopular, "simpleCarouselItem", true) };
      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(
    searchQuery: SearchQuery<SearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    const taxonomy = await this.getTaxonomy();
    return new ValirScansAdvancedSearchForm(searchQuery, taxonomy.genres, taxonomy.tags);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const browse = parseBrowsePage(
      await fetchBrowsePage(page, query.title, sortingOption?.id, query.metadata),
    );
    return {
      items: browse.series.map(toSearchResultItem),
      metadata: browse.hasMore ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private getTaxonomy(): Promise<FilterTaxonomy> {
    this.taxonomyPromise ??= fetchBrowsePage(1)
      .then(parseFilterTaxonomy)
      .then((taxonomy) => (taxonomy.genres.length > 0 ? taxonomy : { ...taxonomy, genres: GENRES }))
      .catch((error: unknown) => {
        // Drop the failed memo so the next form open retries, then let the
        // error (e.g. a Cloudflare challenge) reach the app.
        this.taxonomyPromise = undefined;
        throw error;
      });
    return this.taxonomyPromise;
  }

  // Every homepage section is fed by one document; share the in-flight fetch so
  // a refresh burst is a single request, while still refetching on next refresh.
  private getHomeSections(): Promise<HomeSections> {
    this.homePromise ??= fetchHomePage()
      .then(parseHomeSections)
      .finally(() => {
        this.homePromise = undefined;
      });
    return this.homePromise;
  }
}

export const ValirScans = new ValirScansExtension();
