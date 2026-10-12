/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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
  type Tag,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import {
  YaoiMeAdvancedSearchForm,
  YaoiMeSettingsForm,
  getPreferences,
  getSectionOrder,
  getVisibleSections,
} from "./forms";
import {
  SECTION_DEFINITIONS,
  SECTIONS,
  SORT_OPTIONS,
  type MangaCard,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  YaoiMeInterceptor,
  fetchBrowsePage,
  fetchChapterPage,
  fetchHomePage,
  fetchSeriesPage,
} from "./network";
import {
  hasNextPage,
  parseBrowseCards,
  parseChapterDetails,
  parseChapters,
  parseGenres,
  parseHomeCards,
  parseMangaDetails,
  parseMangaId,
  toFeaturedItem,
  toGenreItem,
  toLatestItem,
  toProminentItem,
  toSearchResult,
  toSimpleItem,
} from "./parsers";
import type YaoiMeConfig from "./pbconfig";

class YaoiMeExtension implements ExtensionImpl<typeof YaoiMeConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new YaoiMeInterceptor("main", getPreferences, getSectionOrder);
  private homePromise?: Promise<CheerioAPI>;
  private genresPromise?: Promise<Tag[]>;

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
    this.clearMemos();
  }

  private clearMemos = (): void => {
    this.homePromise = undefined;
    this.genresPromise = undefined;
  };

  async getSettingsForm(): Promise<Form> {
    return new YaoiMeSettingsForm(getPreferences(), getVisibleSections(), this.clearMemos);
  }

  // Discover asks for its sections on every refresh, so the home page is fetched fresh each time.
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    this.homePromise = undefined;
    const visible = new Set(getVisibleSections());
    return getSectionOrder()
      .filter((id) => visible.has(id))
      .map((id) => SECTION_DEFINITIONS[id]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.GENRES:
        return { items: (await this.getGenres()).map(toGenreItem) };
      case SECTIONS.POPULAR:
        return this.getHomeSectionItems("Popular updates", (card) => [toFeaturedItem(card)]);
      case SECTIONS.BINGE:
        return this.getHomeSectionItems("Binge-worthy", (card) => [toProminentItem(card)]);
      case SECTIONS.TRENDING:
        return this.getHomeSectionItems("Trending now", (card) => [toSimpleItem(card)]);
      case SECTIONS.TOP_RATED:
        return this.getHomeSectionItems("Top rated", (card) => [toSimpleItem(card)]);
      case SECTIONS.LATEST:
        return this.getHomeSectionItems("Latest releases", (card) => {
          const item = toLatestItem(card);
          return item ? [item] : [];
        });
      case SECTIONS.BOOKMARKED:
        return this.getHomeSectionItems("Most bookmarked", (card) => [toFeaturedItem(card, true)]);
      case SECTIONS.HIDDEN_GEMS:
        return this.getHomeSectionItems("Hidden gems", (card) => [toProminentItem(card)]);
      case SECTIONS.TALKED:
        return this.getHomeSectionItems("Most talked about", (card) => [toSimpleItem(card)]);
      case SECTIONS.RISING:
        return this.getHomeSectionItems("Rising", (card) => [toSimpleItem(card)]);
      default:
        return { items: [] };
    }
  }

  // Every row comes from the one home page, shared by the sections loading together.
  private async getHomeSectionItems(
    heading: string,
    toItems: (card: MangaCard) => DiscoverSectionItem[],
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await (this.homePromise ??= fetchHomePage());
    return { items: parseHomeCards($, heading).flatMap(toItems) };
  }

  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchBrowsePage(1, "", {}, SORT_OPTIONS[0].id).then(
      parseGenres,
    ));
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new YaoiMeAdvancedSearchForm(query, getPreferences(), await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title);
    if (pasted) return pasted;
    const preferences = getPreferences();
    const searchMetadata: SearchMetadata = {
      languages: preferences.chapterLanguages,
      ratings: preferences.contentRatings,
      types: preferences.contentTypes,
      ...query.metadata,
      tags: {
        ...Object.fromEntries(preferences.hiddenTags.map((tag) => [tag, "excluded"] as const)),
        ...query.metadata?.tags,
      },
    };
    const page = metadata?.page ?? 1;
    const $ = await fetchBrowsePage(
      page,
      query.title,
      searchMetadata,
      sortingOption?.id ?? SORT_OPTIONS[0].id,
    );
    return {
      items: parseBrowseCards($).map(toSearchResult),
      metadata: hasNextPage($, page) ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query
      .trim()
      .match(/^https?:\/\/(?:www\.)?yaoi\.me\/series\/\d+\/[a-zA-Z0-9._~-]+\/?$/i)?.[0];
    if (!url) return undefined;
    const mangaId = parseMangaId(url);
    if (!mangaId) return undefined;
    try {
      const manga = await this.getMangaDetails(mangaId);
      return {
        items: [
          {
            mangaId,
            title: manga.mangaInfo.primaryTitle,
            imageUrl: manga.mangaInfo.thumbnailUrl,
            contentRating: manga.mangaInfo.contentRating,
          },
        ],
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchSeriesPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(
      await fetchSeriesPage(sourceManga.mangaId),
      sourceManga,
      getPreferences().chapterLanguages,
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(
      await fetchChapterPage(chapter.chapterId),
      chapter.chapterId,
      chapter.sourceManga.mangaId,
    );
  }
}

export const YaoiMe = new YaoiMeExtension();
