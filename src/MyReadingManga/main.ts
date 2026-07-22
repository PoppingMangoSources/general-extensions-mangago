/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
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

import {
  getPreferredLanguages,
  MyReadingMangaAdvancedSearchForm,
  MyReadingMangaSettingsForm,
} from "./forms";
import {
  DISCOVER_SECTIONS,
  LISTING_PATHS,
  SORTING_OPTIONS,
  type FilterTaxonomies,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchListingPage,
  fetchMangaPage,
  fetchSearchPage,
  MyReadingMangaInterceptor,
} from "./network";
import {
  hasNextPage,
  parseChapters,
  parseFilterTaxonomies,
  parseListing,
  parseMangaDetails,
  parsePages,
} from "./parsers";
import type MyReadingMangaConfig from "./pbconfig";

export class MyReadingMangaExtension implements ExtensionImpl<typeof MyReadingMangaConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 1,
    bufferInterval: 1,
    ignoreImages: true,
  });

  mainInterceptor = new MyReadingMangaInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  // Filter taxonomies are scraped from the search sidebar once per session.
  private taxonomiesPromise?: Promise<FilterTaxonomies>;

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
    this.taxonomiesPromise = undefined;
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
    return new MyReadingMangaSettingsForm();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await fetchMangaPage(mangaId);
    return parseMangaDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await fetchMangaPage(sourceManga.mangaId);
    return parseChapters($, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const $ = await fetchMangaPage(chapter.sourceManga.mangaId, parseInt(chapter.chapterId, 10));
    return parsePages($, chapter);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      return this.getGenresSection();
    }

    const page = metadata?.page ?? 1;
    const $ = await fetchListingPage(LISTING_PATHS[section.id] ?? "/", page);
    const cards = parseListing($, getPreferredLanguages());
    const items: DiscoverSectionItem[] = cards.map((card) =>
      section.id === "popular"
        ? {
            type: "featuredCarouselItem",
            mangaId: card.mangaId,
            title: card.title,
            imageUrl: card.imageUrl,
            contentRating: ContentRating.ADULT,
          }
        : {
            type: "simpleCarouselItem",
            mangaId: card.mangaId,
            title: card.title,
            imageUrl: card.imageUrl,
            contentRating: ContentRating.ADULT,
          },
    );
    return {
      items,
      metadata: hasNextPage($) && items.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  private async getGenresSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const taxonomies = await this.getTaxonomies();
    const items: DiscoverSectionItem[] = (taxonomies.genre ?? []).map((genre) => ({
      type: "genresCarouselItem",
      name: genre.title,
      searchQuery: {
        title: "",
        metadata: { genre: genre.id } satisfies SearchMetadata,
      },
    }));
    return { items };
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MyReadingMangaAdvancedSearchForm(query, await this.getTaxonomies());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchSearchPage(page, query.title, sortingOption?.id, query.metadata);
    const items: SearchResultItem[] = parseListing($, []).map((card) => ({
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      contentRating: ContentRating.ADULT,
    }));
    return {
      items,
      metadata: hasNextPage($) && items.length > 0 ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private getTaxonomies(): Promise<FilterTaxonomies> {
    this.taxonomiesPromise ??= fetchSearchPage(1, "", "rand").then(parseFilterTaxonomies);
    return this.taxonomiesPromise;
  }
}

export const MyReadingManga = new MyReadingMangaExtension();
