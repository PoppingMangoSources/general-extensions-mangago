/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  DiscoverSectionType,
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

import { NovelCoolAdvancedSearchForm } from "./forms";
import {
  SECTIONS,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
  type SearchOptions,
} from "./models";
import {
  fetchCategoryPage,
  fetchChapterPage,
  fetchContentPage,
  fetchHomePage,
  fetchSearchPage,
  NovelCoolInterceptor,
} from "./network";
import {
  hasNextPage,
  parseChapterDetails,
  parseChapters,
  parseFeatured,
  parseListings,
  parseMangaDetails,
  parseSearchOptions,
  pickTriState,
  toFeaturedItem,
  toLatestItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type NovelCoolConfig from "./pbconfig";

class NovelCoolExtension implements ExtensionImpl<typeof NovelCoolConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new NovelCoolInterceptor("main");
  private homePromise?: ReturnType<typeof fetchHomePage>;
  private searchOptionsPromise?: Promise<SearchOptions>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    this.homePromise = undefined;
    this.searchOptionsPromise = undefined;
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
      { id: SECTIONS.LATEST, title: "Latest", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.COMPLETED, title: "Completed", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.TYPES, title: "Types", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED:
        return {
          items: parseFeatured(await this.getHomePage())
            .filter((item) => item.imageUrl.length > 0)
            .map(toFeaturedItem),
        };
      case SECTIONS.LATEST:
        return this.getListingSection("/category/latest.html", metadata, toLatestItem);
      case SECTIONS.POPULAR:
        return this.getListingSection("/category/popular.html", metadata, toSimpleItem);
      case SECTIONS.COMPLETED:
        return this.getCompletedSection(metadata);
      case SECTIONS.TYPES:
        return {
          items: TYPE_OPTIONS.map((type) => ({
            type: "genresCarouselItem",
            name: type.title,
            searchQuery: { title: "", metadata: { type: [type.id] } satisfies SearchMetadata },
          })),
        };
      default:
        return { items: [] };
    }
  }

  private getHomePage(): ReturnType<typeof fetchHomePage> {
    return (this.homePromise ??= fetchHomePage());
  }

  private getSearchOptions(): Promise<SearchOptions> {
    return (this.searchOptionsPromise ??= fetchSearchPage({ page: 1 }).then(parseSearchOptions));
  }

  private async getListingSection(
    path: string,
    metadata: PageMetadata | undefined,
    mapper: (item: ReturnType<typeof parseListings>[number]) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchCategoryPage(path, page);
    return {
      items: parseListings(document)
        .filter((item) => item.imageUrl.length > 0)
        .map(mapper),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async getCompletedSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchSearchPage({ page, status: "2" });
    return {
      items: parseListings(document)
        .filter((item) => item.imageUrl.length > 0)
        .map(toSimpleItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new NovelCoolAdvancedSearchForm(query, await this.getSearchOptions());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const searchMetadata = query.metadata ?? {};
    const page = metadata?.page ?? 1;
    const document = await fetchSearchPage({
      page,
      title: (query.title ?? "").trim() || undefined,
      author: searchMetadata.author,
      status: searchMetadata.status?.[0],
      genresInclude: pickTriState(searchMetadata.genres, "included"),
      genresExclude: pickTriState(searchMetadata.genres, "excluded"),
      type: searchMetadata.type?.[0],
      year: searchMetadata.year?.[0],
      alphabet: searchMetadata.alphabet?.[0],
      sort: sortingOption?.id,
    });
    return {
      items: parseListings(document)
        .filter((item) => item.imageUrl.length > 0)
        .map(toSearchResultItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchContentPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchContentPage(sourceManga.mangaId), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(await fetchChapterPage(chapter.chapterId), chapter);
  }
}

export const NovelCool = new NovelCoolExtension();
