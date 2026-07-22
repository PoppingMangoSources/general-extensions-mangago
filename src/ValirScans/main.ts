/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { getShowPaidChapters, ValirScansSettingsForm } from "./forms";
import { DISCOVER_SECTIONS, SORTING_OPTIONS, type HomeSections, type PageMetadata } from "./models";
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
    if (section.id === "new-series") {
      const page = metadata?.page ?? 1;
      const browse = parseBrowsePage(await fetchBrowsePage(page, undefined, "newest"));
      return {
        items: toCarouselItems(browse.series, "simpleCarouselItem"),
        metadata: browse.hasMore ? { page: page + 1 } : undefined,
      };
    }

    const home = await this.getHomeSections();
    switch (section.id) {
      case "featured":
        return { items: toFeaturedItems(home.featured) };
      case "editors-picks":
        return { items: toCarouselItems(home.editorsPicks, "prominentCarouselItem") };
      case "latest-comics":
        return { items: toChapterUpdateItems(home.latestUpdates, false) };
      case "latest-novels":
        return { items: toChapterUpdateItems(home.latestUpdates, true) };
      case "popular-today":
        return { items: toCarouselItems(home.popularToday, "prominentCarouselItem", true) };
      case "most-popular":
        return { items: toCarouselItems(home.mostPopular, "simpleCarouselItem", true) };
      default:
        return { items: [] };
    }
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const browse = parseBrowsePage(await fetchBrowsePage(page, query.title, sortingOption?.id));
    return {
      items: browse.series.map(toSearchResultItem),
      metadata: browse.hasMore ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<Metadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  // Every homepage discover section is fed by the same document; sharing one
  // in-flight fetch keeps a refresh burst to a single request while still
  // re-fetching fresh data on the next refresh.
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
