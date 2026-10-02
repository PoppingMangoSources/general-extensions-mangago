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
  private seriesPage?: { mangaId: string; promise: Promise<CheerioAPI> };

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
    this.seriesPage = undefined;
  };

  async getSettingsForm(): Promise<Form> {
    return new YaoiMeSettingsForm(getPreferences(), getVisibleSections(), this.clearMemos);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const visible = new Set(getVisibleSections());
    return getSectionOrder()
      .filter((id) => visible.has(id))
      .map((id) => SECTION_DEFINITIONS[id]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.GENRES) {
      return { items: (await this.getGenres()).map(toGenreItem) };
    }
    const $ = await this.getHomePage();
    switch (section.id) {
      case SECTIONS.POPULAR:
        return { items: parseHomeCards($, "Popular updates").map((card) => toFeaturedItem(card)) };
      case SECTIONS.BINGE:
        return { items: parseHomeCards($, "Binge-worthy").map(toProminentItem) };
      case SECTIONS.TRENDING:
        return { items: parseHomeCards($, "Trending now").map(toSimpleItem) };
      case SECTIONS.TOP_RATED:
        return { items: parseHomeCards($, "Top rated").map(toSimpleItem) };
      case SECTIONS.LATEST:
        return {
          items: parseHomeCards($, "Latest releases").flatMap((card) => {
            const item = toLatestItem(card);
            return item ? [item] : [];
          }),
        };
      case SECTIONS.BOOKMARKED:
        return {
          items: parseHomeCards($, "Most bookmarked").map((card) => toFeaturedItem(card, true)),
        };
      case SECTIONS.HIDDEN_GEMS:
        return { items: parseHomeCards($, "Hidden gems").map(toProminentItem) };
      case SECTIONS.TALKED:
        return { items: parseHomeCards($, "Most talked about").map(toSimpleItem) };
      case SECTIONS.RISING:
        return { items: parseHomeCards($, "Rising").map(toSimpleItem) };
      default:
        return { items: [] };
    }
  }

  private getHomePage(): Promise<CheerioAPI> {
    return (this.homePromise ??= fetchHomePage());
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

  private getSeriesPage(mangaId: string): Promise<CheerioAPI> {
    if (this.seriesPage?.mangaId === mangaId) return this.seriesPage.promise;
    const promise = fetchSeriesPage(mangaId);
    this.seriesPage = { mangaId, promise };
    return promise;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await this.getSeriesPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = parseChapters(await this.getSeriesPage(sourceManga.mangaId), sourceManga);
    if (!chapters.length) throw new Error(`No chapters found for ${sourceManga.mangaId}.`);
    return chapters;
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
