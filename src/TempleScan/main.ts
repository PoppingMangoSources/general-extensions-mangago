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

import { getShowPaidChapters, TempleScanAdvancedSearchForm, TempleScanSettingsForm } from "./forms";
import {
  DISCOVER_SECTIONS,
  PAGE_SIZE,
  SORTING_OPTIONS,
  TRENDING_RANGES,
  type BrowseSeries,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchChapterPage,
  fetchDirectory,
  fetchFeatured,
  fetchHomePage,
  fetchSeriesPage,
  fetchTrending,
  TempleScanInterceptor,
} from "./network";
import {
  parseChapterPages,
  parseChapters,
  parseDirectory,
  parseFeatured,
  parseHomeSections,
  parseSeriesData,
  parseTrending,
  toFeaturedItems,
  toSearchResultItem,
  toSourceManga,
  toTrendingItems,
  toUpdateItems,
  withFeaturedCovers,
  type HomeSections,
} from "./parsers";
import type TempleScanConfig from "./pbconfig";

export class TempleScanExtension implements ExtensionImpl<typeof TempleScanConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  mainInterceptor = new TempleScanInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  // The browse endpoint returns the whole directory; cache it per session.
  private directoryPromise?: Promise<BrowseSeries[]>;
  private featuredPromise?: Promise<DiscoverSectionItem[]>;
  private homePromise?: Promise<HomeSections>;

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
    this.directoryPromise = undefined;
    this.featuredPromise = undefined;
    this.homePromise = undefined;
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
    return new TempleScanSettingsForm();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const data = parseSeriesData(await fetchSeriesPage(mangaId), mangaId);
    return toSourceManga(data, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const data = parseSeriesData(await fetchSeriesPage(sourceManga.mangaId), sourceManga.mangaId);
    return parseChapters(data, sourceManga, getShowPaidChapters());
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const payload = await fetchChapterPage(chapter.sourceManga.mangaId, chapter.chapterId);
    return parseChapterPages(payload, chapter);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "featured":
        return { items: await this.getFeaturedItems() };
      case "new-series": {
        const home = await this.getHomeSections();
        return {
          items: home.newSeries.map((series) => ({
            type: "simpleCarouselItem",
            mangaId: series.series_slug,
            title: series.title,
            imageUrl: series.thumbnail ?? "",
            subtitle: series.badge ?? undefined,
          })),
        };
      }
      case "latest": {
        const home = await this.getHomeSections();
        return { items: toUpdateItems(home.updates) };
      }
      case "trending":
        return {
          items: TRENDING_RANGES.map((range) => ({
            type: "genresCarouselItem",
            name: range.title,
            searchQuery: {
              title: "",
              metadata: { trending: range.id } satisfies SearchMetadata,
            },
          })),
        };
      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new TempleScanAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    if (query.metadata?.trending) {
      const entries = parseTrending(await fetchTrending(), query.metadata.trending);
      return { items: toTrendingItems(entries) };
    }

    const page = metadata?.page ?? 1;
    const title = query.title.trim().toLowerCase();
    const status = query.metadata?.status;

    const filtered = (await this.getDirectory()).filter((series) => {
      const titleMatch =
        title.length === 0 ||
        series.title.toLowerCase().includes(title) ||
        (series.alternative_names ?? "").toLowerCase().includes(title);
      return titleMatch && (!status || series.status === status);
    });

    const time = (value: string | null | undefined): number => {
      const parsed = new Date(value ?? "").getTime();
      return isNaN(parsed) ? 0 : parsed;
    };
    const sorted = [...filtered].sort((a, b) => {
      switch (sortingOption?.id) {
        case "updated":
          return time(b.update_chapter) - time(a.update_chapter);
        case "created":
          return time(b.created_at) - time(a.created_at);
        default:
          return (b.total_views ?? 0) - (a.total_views ?? 0);
      }
    });

    return {
      items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toSearchResultItem),
      metadata: page * PAGE_SIZE < sorted.length ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private getDirectory(): Promise<BrowseSeries[]> {
    this.directoryPromise ??= fetchDirectory().then(parseDirectory);
    return this.directoryPromise;
  }

  private getFeaturedItems(): Promise<DiscoverSectionItem[]> {
    this.featuredPromise ??= Promise.all([fetchFeatured().then(parseFeatured), this.getDirectory()])
      .then(([entries, directory]) => withFeaturedCovers(entries, directory))
      .then(toFeaturedItems)
      .catch((error: unknown) => {
        this.featuredPromise = undefined;
        throw error;
      });
    return this.featuredPromise;
  }

  // New Series and Latest Updates share the homepage; dedupe the fetch
  // within a refresh burst while reloading fresh data on the next refresh.
  private getHomeSections(): Promise<HomeSections> {
    this.homePromise ??= fetchHomePage()
      .then(parseHomeSections)
      .finally(() => {
        this.homePromise = undefined;
      });
    return this.homePromise;
  }
}

export const TempleScan = new TempleScanExtension();
