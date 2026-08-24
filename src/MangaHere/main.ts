/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
  CookieStorageInterceptor,
  DiscoverSectionType,
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
import type * as cheerio from "cheerio";

import { MangaHereAdvancedSearchForm, MangaHereSettingsForm, getShowAdultTitles } from "./forms";
import {
  DOMAIN,
  GENRES,
  HOME_TITLES,
  RANKING_PERIODS,
  SECTIONS,
  SORT_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
  type SearchRequest,
} from "./models";
import {
  chapterUrl,
  fetchDocument,
  homeUrl,
  latestUrl,
  listingUrl,
  MangaHereInterceptor,
  mangaUrl,
  mobileHomeUrl,
  rankingUrl,
  searchUrl,
} from "./network";
import {
  contentRatingForGenres,
  filterAdultItems,
  parseChapters,
  parseHasNextPage,
  parseHomeSection,
  parseMangaDetails,
  parseMangaId,
  parseMangaList,
  parseMobileHomeSection,
  parseRankingList,
  parseReaderMetadata,
  toChapterUpdateItem,
  toFeaturedItem,
  toRankingSearchItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type MangaHereConfig from "./pbconfig";
import { loadChapterPages } from "./utils";

export class MangaHereExtension implements ExtensionImpl<typeof MangaHereConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new MangaHereInterceptor("main");
  private homePromise?: Promise<cheerio.CheerioAPI>;
  private mobileHomePromise?: Promise<cheerio.CheerioAPI>;

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
    this.homePromise = undefined;
    this.mobileHomePromise = undefined;
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
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaHereSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.RECOMMENDED,
        title: "Recommended",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.NEW,
        title: "New Manga Releases",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.LATEST,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
      },
      { id: SECTIONS.RANKING, title: "Ranking", type: DiscoverSectionType.genres },
      {
        id: SECTIONS.READING_NOW,
        title: "Being Read Right Now",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.TRENDING,
        title: "Trending Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.HOT,
        title: "Hot Manga Releases",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const results = await this.loadDiscoverSection(section, metadata);
    return { ...results, items: filterAdultItems(results.items, getShowAdultTitles()) };
  }

  private async loadDiscoverSection(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.POPULAR:
        return this.getPopularSection(metadata);
      case SECTIONS.RECOMMENDED:
        return this.getHomeSection(HOME_TITLES.RECOMMENDED);
      case SECTIONS.NEW:
        return this.getHomeSection(HOME_TITLES.NEW);
      case SECTIONS.LATEST:
        return this.getLatestSection(metadata);
      case SECTIONS.RANKING:
        return this.getRankingSection();
      case SECTIONS.READING_NOW:
        return this.getHomeSection(HOME_TITLES.READING_NOW);
      case SECTIONS.TRENDING:
        return this.getTrendingSection();
      case SECTIONS.HOT:
        return this.getHomeSection(HOME_TITLES.HOT);
      case SECTIONS.GENRES:
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  private async getPopularSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchDocument(listingUrl(page, "po"));
    return {
      items: parseMangaList($, "ul.manga-list-1-list > li").map(toFeaturedItem),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private async getHomeSection(heading: string): Promise<PagedResults<DiscoverSectionItem>> {
    return { items: parseHomeSection(await this.getHome(), heading).map(toSimpleItem) };
  }

  private async getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchDocument(latestUrl(page));
    return {
      items: parseMangaList($, "ul.manga-list-4-list > li").flatMap((item) => {
        const card = toChapterUpdateItem(item);
        return card ? [card] : [];
      }),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private getRankingSection(): PagedResults<DiscoverSectionItem> {
    return {
      items: RANKING_PERIODS.map((period) => ({
        type: "genresCarouselItem",
        name: period.title,
        searchQuery: {
          title: "",
          metadata: { rankingPeriod: period.id } satisfies SearchMetadata,
        },
      })),
    };
  }

  private getGenreSection(): PagedResults<DiscoverSectionItem> {
    return {
      items: GENRES.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
        },
        contentRating: contentRatingForGenres([genre.title]),
      })),
    };
  }

  private async getTrendingSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const [desktop, mobile] = await Promise.all([this.getHome(), this.getMobileHome()]);
    const chapterById = new Map(
      parseHomeSection(desktop, HOME_TITLES.TRENDING).map((item) => [item.mangaId, item]),
    );
    const items = parseMobileHomeSection(mobile, HOME_TITLES.TRENDING).map((item) => {
      const desktopItem = chapterById.get(item.mangaId);
      return desktopItem ? { ...item, chapter: desktopItem.chapter, rank: desktopItem.rank } : item;
    });
    return { items: items.map(toSimpleItem) };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MangaHereAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const results = await this.loadSearchResults(query, metadata, sortingOption);
    return { ...results, items: filterAdultItems(results.items, getShowAdultTitles()) };
  }

  private async loadSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title);
    if (pasted) return pasted;

    const searchMetadata: SearchMetadata = query.metadata ?? {
      genres: {},
      type: [],
      nameMatch: [],
      author: "",
      authorMatch: [],
      artist: "",
      artistMatch: [],
      released: "",
      releasedMatch: [],
      rating: [],
      ratingMatch: [],
      completion: [],
    };
    const rankingPeriod = RANKING_PERIODS.find(
      (period) => period.id === searchMetadata.rankingPeriod,
    );
    if (rankingPeriod) {
      const $ = await fetchDocument(rankingUrl(rankingPeriod.path));
      return {
        items: parseRankingList($, rankingPeriod.className).map(toRankingSearchItem),
      };
    }

    const page = metadata?.page ?? 1;
    const title = query.title.trim();
    const genres = Object.entries(searchMetadata.genres ?? {});
    const includedGenreIds = genres.filter(([, state]) => state === "included").map(([id]) => id);
    const excludedGenreIds = genres.filter(([, state]) => state === "excluded").map(([id]) => id);
    const author = searchMetadata.author?.trim() ?? "";
    const artist = searchMetadata.artist?.trim() ?? "";
    const type = searchMetadata.type?.[0];
    const released = searchMetadata.released?.trim() ?? "";
    const rating = searchMetadata.rating?.[0];
    const completion = searchMetadata.completion?.[0];
    const usesAdvancedSearch = Boolean(
      searchMetadata.nameMatch?.[0] ||
      author ||
      artist ||
      (type && type !== "0") ||
      includedGenreIds.length > 0 ||
      excludedGenreIds.length > 0 ||
      released ||
      rating != null ||
      (completion && completion !== "0"),
    );

    const genre = GENRES.find((option) => option.id === includedGenreIds[0]);
    const canUseDirectory =
      !title &&
      !author &&
      !artist &&
      (!type || type === "0") &&
      !released &&
      rating == null &&
      includedGenreIds.length <= 1 &&
      excludedGenreIds.length === 0;
    const status = completion === "2" ? "completed" : completion === "1" ? "on_going" : undefined;

    const $ = await fetchDocument(
      canUseDirectory
        ? listingUrl(page, sortingOption?.id ?? SORT_OPTIONS[0].id, genre?.slug, status)
        : searchUrl(
            page,
            this.buildSearchRequest(
              title,
              searchMetadata,
              includedGenreIds,
              excludedGenreIds,
              usesAdvancedSearch,
            ),
          ),
    );
    const items = parseMangaList(
      $,
      canUseDirectory ? "ul.manga-list-1-list > li" : "ul.manga-list-4-list > li",
    );
    const selectedGenreNames = includedGenreIds.flatMap((id) => {
      const option = GENRES.find((candidate) => candidate.id === id);
      return option ? [option.title] : [];
    });
    // With no genre selected there is nothing to infer from, so cards fall back to unrated.
    const fallbackRating = contentRatingForGenres(selectedGenreNames);
    return {
      items: items.map((item) => toSearchResultItem(item, fallbackRating)),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchRequest(
    title: string,
    metadata: SearchMetadata,
    includedGenreIds: string[],
    excludedGenreIds: string[],
    usesAdvancedSearch: boolean,
  ): SearchRequest {
    return {
      title: !usesAdvancedSearch && title ? title : undefined,
      name: usesAdvancedSearch && title ? title : undefined,
      nameMethod: metadata.nameMatch?.[0],
      author: metadata.author,
      authorMethod: metadata.authorMatch?.[0],
      artist: metadata.artist,
      artistMethod: metadata.artistMatch?.[0],
      type: metadata.type?.[0],
      includedGenres: includedGenreIds,
      excludedGenres: excludedGenreIds,
      released: metadata.released,
      releasedMethod: metadata.releasedMatch?.[0],
      rating: metadata.rating?.[0],
      ratingMethod: metadata.ratingMatch?.[0],
      completion: metadata.completion?.[0],
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query
      .trim()
      .match(/^https?:\/\/(?:www\.|newm\.|m\.)?mangahere\.cc\/manga\/[^/?#]+\/?$/i)?.[0];
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
    return parseMangaDetails(await fetchDocument(mangaUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchDocument(mangaUrl(sourceManga.mangaId)), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const readerUrl = chapterUrl(mangaId, chapter.chapterId);
    const $ = await fetchDocument(readerUrl);
    const metadata = parseReaderMetadata($);
    if (!metadata) throw new Error(`No reader data found for chapter ${chapter.chapterId}`);
    const pages = await loadChapterPages(
      $,
      readerUrl,
      metadata,
      this.cookieStorageInterceptor.cookiesForUrl(`${DOMAIN}/`),
    );
    if (pages.length === 0) throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    return { id: chapter.chapterId, mangaId, pages };
  }

  private getHome(): Promise<cheerio.CheerioAPI> {
    this.homePromise ??= fetchDocument(homeUrl()).finally(() => {
      this.homePromise = undefined;
    });
    return this.homePromise;
  }

  private getMobileHome(): Promise<cheerio.CheerioAPI> {
    this.mobileHomePromise ??= fetchDocument(mobileHomeUrl()).finally(() => {
      this.mobileHomePromise = undefined;
    });
    return this.mobileHomePromise;
  }
}

export const MangaHere = new MangaHereExtension();
