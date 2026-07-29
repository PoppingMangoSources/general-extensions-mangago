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
  GalaxyMangaAdvancedSearchForm,
  GalaxyMangaSettingsForm,
  getSectionOrder,
  getVisibleSections,
} from "./forms";
import {
  MANGA_DIR,
  NEXT_PAGE_SELECTOR,
  RECOMMENDED_GENRE_NAMES,
  SECTION_DEFINITIONS,
  SECTIONS,
  SORT_OPTIONS,
  TRENDING_RANGES,
  type MangaCard,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchChapterPage,
  fetchDirectoryPage,
  fetchHomePage,
  fetchMangaPage,
  GalaxyMangaInterceptor,
  type DirectoryRequest,
} from "./network";
import {
  contentRatingForGenres,
  parseCards,
  parseChapterPages,
  parseChapters,
  parseGenreOptions,
  parseLatestCards,
  parseMangaDetails,
  parseMangaId,
  parseTrendingCards,
  parseWidgetCards,
  toLatestItem,
  toPopularFeaturedItem,
  toSearchResultItem,
  toSimpleItem,
  toTrendingResultItem,
} from "./parsers";
import type GalaxyMangaConfig from "./pbconfig";

const triStateValues = (
  genres: SearchMetadata["genres"],
  state: "included" | "excluded",
): string[] =>
  Object.entries(genres ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => id);

class GalaxyMangaExtension implements ExtensionImpl<typeof GalaxyMangaConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new GalaxyMangaInterceptor("main");
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
    this.homePromise = undefined;
    this.genresPromise = undefined;
  }

  async getSettingsForm(): Promise<Form> {
    return new GalaxyMangaSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const visible = new Set(getVisibleSections());
    return getSectionOrder()
      .filter((id) => visible.has(id))
      .map((id) => SECTION_DEFINITIONS[id]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    switch (section.id) {
      case SECTIONS.POPULAR:
        return this.getDirectorySection({ order: "popular" }, page, toPopularFeaturedItem);
      case SECTIONS.TRENDING:
        return {
          items: TRENDING_RANGES.map((range) => ({
            type: "genresCarouselItem",
            name: range.title,
            searchQuery: {
              title: "",
              metadata: { trendingRange: range.id } satisfies SearchMetadata,
            },
          })),
        };
      case SECTIONS.POPULAR_TODAY:
        return {
          items: parseWidgetCards(await this.getHomePage(), "Popular Today").map(toSimpleItem),
        };
      case SECTIONS.LATEST:
        return {
          items: parseLatestCards(await this.getHomePage()).flatMap((card) => {
            const item = toLatestItem(card);
            return item ? [item] : [];
          }),
        };
      case SECTIONS.RECOMMENDATION:
        return this.getRecommendationSection();
      case SECTIONS.FRESH:
        return this.getDirectorySection({ order: "latest" }, page, toSimpleItem);
      case SECTIONS.GENRES:
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  private async getDirectorySection(
    request: DirectoryRequest,
    page: number,
    mapper: (card: MangaCard) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await fetchDirectoryPage(page, request);
    return {
      items: parseCards($).map(mapper),
      metadata: $(NEXT_PAGE_SELECTOR).length > 0 ? { page: page + 1 } : undefined,
    };
  }

  private async getRecommendationSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const genres = await this.getGenres();
    return {
      items: RECOMMENDED_GENRE_NAMES.flatMap((name): DiscoverSectionItem[] => {
        const genre = genres.find((option) => option.title.toLowerCase() === name.toLowerCase());
        if (!genre) return [];
        return [
          {
            type: "genresCarouselItem",
            name: genre.title,
            searchQuery: {
              title: "",
              metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
            },
            contentRating: contentRatingForGenres([genre.title]),
          },
        ];
      }),
    };
  }

  private async getGenreSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: (await this.getGenres()).map(
        (genre): DiscoverSectionItem => ({
          type: "genresCarouselItem",
          name: genre.title,
          searchQuery: {
            title: "",
            metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
          },
          contentRating: contentRatingForGenres([genre.title]),
        }),
      ),
    };
  }

  private async getHomePage(): Promise<CheerioAPI> {
    const request = (this.homePromise ??= fetchHomePage());
    try {
      return await request;
    } finally {
      if (this.homePromise === request) this.homePromise = undefined;
    }
  }

  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchDirectoryPage(1).then(parseGenreOptions));
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new GalaxyMangaAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const searchMetadata: SearchMetadata = query.metadata ?? {
      genres: {},
      statuses: [],
      types: [],
    };

    if (searchMetadata.trendingRange) {
      return {
        items: parseTrendingCards(await this.getHomePage(), searchMetadata.trendingRange).map(
          toTrendingResultItem,
        ),
      };
    }

    const $ = await fetchDirectoryPage(page, {
      title: query.title.trim() || undefined,
      order: sortingOption?.id || undefined,
      statuses: searchMetadata.statuses,
      types: searchMetadata.types,
      includedGenres: triStateValues(searchMetadata.genres, "included"),
      excludedGenres: triStateValues(searchMetadata.genres, "excluded"),
    });
    return {
      items: parseCards($).map(toSearchResultItem),
      metadata: $(NEXT_PAGE_SELECTOR).length > 0 ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query
      .trim()
      .match(new RegExp(`^https?://(?:www\\.)?galaxymanga\\.io/${MANGA_DIR}/[^/?#]+/?$`, "i"))?.[0];
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
    return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = parseChapters(await fetchMangaPage(sourceManga.mangaId), sourceManga);
    if (chapters.length === 0) {
      throw new Error(`No chapters found for ${sourceManga.mangaId}.`);
    }
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages = parseChapterPages(await fetchChapterPage(chapter.chapterId));
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}.`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }
}

export const GalaxyManga = new GalaxyMangaExtension();
