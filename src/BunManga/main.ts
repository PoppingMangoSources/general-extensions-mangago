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
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import { BunMangaAdvancedSearchForm } from "./forms";
import {
  PAGE_SIZE,
  SECTIONS,
  SORT_OPTIONS,
  type MangaListItem,
  type PageMetadata,
  type SearchMetadata,
  type SearchRequest,
} from "./models";
import {
  buildSearchUrl,
  BunMangaInterceptor,
  fetchChapterList,
  fetchHomePage,
  fetchLoadMorePage,
  fetchMangaPage,
  fetchReaderPage,
  fetchSearchPage,
} from "./network";
import {
  contentRatingForGenres,
  hasLoadMore,
  parseChapterDetails,
  parseChapters,
  parseGenreTags,
  parseLatestUpdates,
  parseLoadMoreQueryVars,
  parseMangaDetails,
  parseMangaId,
  parseMangaList,
  parsePopular,
  parseTopDaily,
  parseTotalResults,
  toChapterUpdateItem,
  toFeaturedItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type BunMangaConfig from "./pbconfig";

const includedValues = (value: SearchMetadata["genres"]): string[] =>
  Object.entries(value ?? {})
    .filter(([, state]) => state === "included")
    .map(([id]) => id);

class BunMangaExtension implements ExtensionImpl<typeof BunMangaConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new BunMangaInterceptor("main");
  private homePromise?: ReturnType<typeof fetchHomePage>;
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

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.TOP_DAILY,
        title: "Top Daily",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.LATEST_UPDATES,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: SECTIONS.RELEVANCE,
        title: "Relevance",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.TOP_RATED,
        title: "Top Rated",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.TRENDING,
        title: "Trending",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.POPULAR:
        return this.getPopularSection();
      case SECTIONS.TOP_DAILY:
        return {
          items: parseTopDaily(await this.getHomePage()).map(toSimpleItem),
        };
      case SECTIONS.LATEST_UPDATES:
        return {
          items: parseLatestUpdates(await this.getHomePage()).flatMap((item) => {
            const mapped = toChapterUpdateItem(item);
            return mapped ? [mapped] : [];
          }),
        };
      case SECTIONS.RELEVANCE:
        return this.getSearchSection("relevance", metadata, toSimpleItem);
      case SECTIONS.TOP_RATED:
        return this.getSearchSection("rating", metadata, toSimpleItem);
      case SECTIONS.TRENDING:
        return this.getSearchSection("trending", metadata, toSimpleItem);
      case SECTIONS.GENRES:
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  private async getHomePage(): ReturnType<typeof fetchHomePage> {
    const request = (this.homePromise ??= fetchHomePage());
    try {
      return await request;
    } finally {
      if (this.homePromise === request) this.homePromise = undefined;
    }
  }

  private async getPopularSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: parsePopular(await this.getHomePage()).map(toFeaturedItem),
    };
  }

  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchSearchPage({ sortBy: "relevance" }).then(parseGenreTags));
  }

  private async getPagedSearch(
    request: SearchRequest,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<MangaListItem>> {
    const page = metadata?.page ?? 1;
    const document =
      page === 1
        ? await fetchSearchPage(request)
        : metadata?.queryVars
          ? await fetchLoadMorePage(page - 1, metadata.queryVars, buildSearchUrl(request))
          : undefined;
    if (!document) return { items: [] };

    const items = parseMangaList(document);
    const queryVars = metadata?.queryVars ?? parseLoadMoreQueryVars(document);
    const total = metadata?.total ?? parseTotalResults(document);
    const more =
      queryVars != null &&
      items.length > 0 &&
      (total != null
        ? page * PAGE_SIZE < total
        : page === 1
          ? hasLoadMore(document)
          : items.length === PAGE_SIZE);

    return {
      items,
      metadata: more ? { page: page + 1, queryVars, ...(total != null && { total }) } : undefined,
    };
  }

  private async getSearchSection(
    sortBy: string,
    metadata: PageMetadata | undefined,
    mapper: (item: MangaListItem) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const request = { sortBy } satisfies SearchRequest;
    const page = await this.getPagedSearch(request, metadata);
    return {
      items: page.items.map(mapper),
      metadata: page.metadata,
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

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new BunMangaAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const searchMetadata = query.metadata ?? {
      genres: {},
      genreMatch: ["or"],
      author: "",
      artist: "",
      releaseYear: "",
      adult: ["all"],
      statuses: [],
    };
    const request: SearchRequest = {
      title: (query.title ?? "").trim() || undefined,
      sortBy: sortingOption?.id ?? SORT_OPTIONS[0].id,
      genres: includedValues(searchMetadata.genres),
      genreMatch: searchMetadata.genreMatch?.[0] === "and" ? "and" : "or",
      author: searchMetadata.author?.trim() || undefined,
      artist: searchMetadata.artist?.trim() || undefined,
      releaseYear: searchMetadata.releaseYear?.trim() || undefined,
      adult: searchMetadata.adult?.[0],
      statuses: searchMetadata.statuses,
    };
    const results = await this.getPagedSearch(request, metadata);
    return {
      items: results.items.map(toSearchResultItem),
      metadata: results.metadata,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query.trim().match(/^https?:\/\/(?:www\.)?bunmanga\.com\/manga\/[^/?#]+\/?$/i)?.[0];
    const mangaId = parseMangaId(url);
    if (!mangaId) return undefined;
    try {
      const manga = parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
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
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchChapterList(sourceManga.mangaId), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(
      await fetchReaderPage(chapter.sourceManga.mangaId, chapter.chapterId),
      chapter,
    );
  }
}

export const BunManga = new BunMangaExtension();
