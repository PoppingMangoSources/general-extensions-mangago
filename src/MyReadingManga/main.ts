/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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
  getHiddenGenres,
  getHiddenTags,
  getOrderedSections,
  getPreferredLanguages,
  MyReadingMangaAdvancedSearchForm,
  MyReadingMangaSettingsForm,
} from "./forms";
import {
  LISTING_PATHS,
  SECTIONS,
  SORTING_OPTIONS,
  TAXONOMIES,
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

class MyReadingMangaExtension implements ExtensionImpl<typeof MyReadingMangaConfig> {
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
    this.mainInterceptor.clearChallenge();
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
    // Hide rows still render (empty) if the taxonomy scrape is unavailable,
    // but a Cloudflare challenge must surface so the app can prompt a bypass.
    const taxonomies = await this.getTaxonomies().catch((error: unknown) => {
      if (error instanceof CloudflareError) throw error;
      return {} as FilterTaxonomies;
    });
    return new MyReadingMangaSettingsForm(taxonomies);
  }

  // Source-wide hidden genres/tags expressed as WordPress card classes.
  private hiddenClasses(): string[] {
    return [
      ...getHiddenGenres().map((slug) => `genre-${slug}`),
      ...getHiddenTags().map((slug) => `tag-${slug}`),
    ];
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
    // Chapters are the post's pagination parts, so the id is the part number.
    const part = parseInt(chapter.chapterId, 10);
    if (isNaN(part) || part < 1) {
      throw new Error("Refresh the chapter list to reload chapters.");
    }
    const $ = await fetchMangaPage(chapter.sourceManga.mangaId, part);
    return parsePages($, chapter);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return getOrderedSections();
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.GENRES) {
      return this.getGenresSection();
    }

    const page = metadata?.page ?? 1;
    // Safe cast: "genres" returned above and every other section id served by
    // getDiscoverSections is a LISTING_PATHS key.
    const $ = await fetchListingPage(LISTING_PATHS[section.id as keyof typeof LISTING_PATHS], page);
    const cards = parseListing($, {
      languages: getPreferredLanguages(),
      excludeClasses: this.hiddenClasses(),
    });
    const items: DiscoverSectionItem[] = cards.map((card) =>
      section.id === SECTIONS.POPULAR
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
    // Page off the site's next link: a page can filter down to nothing and
    // still be followed by pages that do not.
    return { items, metadata: hasNextPage($) ? { page: page + 1 } : undefined };
  }

  private async getGenresSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const taxonomies = await this.getTaxonomies();
    const items: DiscoverSectionItem[] = (taxonomies.genre ?? []).map((genre) => ({
      type: "genresCarouselItem",
      name: genre.title,
      searchQuery: {
        title: "",
        metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
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
    // Facet params only include; excluded terms are dropped by card class.
    const excludeClasses = this.hiddenClasses();
    for (const taxonomy of TAXONOMIES) {
      const record = query.metadata?.[taxonomy.key] ?? {};
      for (const slug of Object.keys(record)) {
        if (record[slug] === "excluded") excludeClasses.push(`${taxonomy.classPrefix}-${slug}`);
      }
    }
    const items: SearchResultItem[] = parseListing($, { excludeClasses }).map((card) => ({
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      contentRating: ContentRating.ADULT,
    }));
    return { items, metadata: hasNextPage($) ? { page: page + 1 } : undefined };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private getTaxonomies(): Promise<FilterTaxonomies> {
    // Drop a rejected scrape so the next open retries.
    const request = (this.taxonomiesPromise ??= fetchSearchPage(1, "", "rand")
      .then(parseFilterTaxonomies)
      .catch((error: unknown) => {
        if (this.taxonomiesPromise === request) this.taxonomiesPromise = undefined;
        throw error;
      }));
    return request;
  }
}

export const MyReadingManga = new MyReadingMangaExtension();
