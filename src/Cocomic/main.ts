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
  type UpdateManager,
} from "@paperback/types";

import { CocomicAdvancedSearchForm } from "./forms";
import {
  SECTIONS,
  SORT_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
  type SearchRequest,
} from "./models";
import {
  CocomicInterceptor,
  fetchChapterList,
  fetchHomePage,
  fetchMangaPage,
  fetchReaderPage,
  fetchSearchPage,
} from "./network";
import {
  hasNextPage,
  parseChapterDetails,
  parseChapters,
  parseGenreTags,
  parseHomepageRail,
  parseTrending,
  parseMangaDetails,
  parseMangaId,
  parseMangaList,
  toChapterUpdateItem,
  toFeaturedItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type CocomicConfig from "./pbconfig";

class CocomicExtension implements ExtensionImpl<typeof CocomicConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new CocomicInterceptor("main");
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
      { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.TRENDING_NOW,
        title: "Trending Now",
        type: DiscoverSectionType.prominentCarousel,
      },
      {
        id: SECTIONS.LATEST_UPDATES,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
      },
      { id: SECTIONS.POPULAR, title: "Popular Manga", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.NEW_RELEASES,
        title: "New Releases",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.GENRES) {
      return {
        items: (await this.getGenres()).map((genre) => ({
          type: "genresCarouselItem",
          name: genre.title,
          searchQuery: {
            title: "",
            metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
          },
        })),
      };
    }
    const document = await this.getHomePage();
    if (section.id === SECTIONS.TRENDING)
      return { items: parseTrending(document).map(toFeaturedItem) };
    const items = parseHomepageRail(document, section.title);
    if (section.id === SECTIONS.LATEST_UPDATES) {
      return {
        items: items.flatMap((item) => {
          const update = toChapterUpdateItem(item);
          return update ? [update] : [];
        }),
      };
    }
    return {
      items: items.map((item) => ({
        ...toSimpleItem(item),
        type: section.id === SECTIONS.TRENDING_NOW ? "prominentCarouselItem" : "simpleCarouselItem",
      })),
    };
  }

  private getHomePage(): ReturnType<typeof fetchHomePage> {
    return (this.homePromise ??= fetchHomePage().finally(() => {
      this.homePromise = undefined;
    }));
  }

  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchSearchPage(1, {})
      .then(parseGenreTags)
      .catch((error: unknown) => {
        this.genresPromise = undefined;
        throw error;
      }));
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new CocomicAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const searchMetadata = query.metadata ?? {};
    const request: SearchRequest = {
      title: (query.title ?? "").trim() || undefined,
      sortBy: sortingOption?.id ?? SORT_OPTIONS[0].id,
      genres: Object.entries(searchMetadata.genres ?? {})
        .filter(([, state]) => state === "included")
        .map(([id]) => id),
      genreMatch: searchMetadata.genreMatch?.[0] === "and" ? "and" : "or",
      author: searchMetadata.author?.trim() || undefined,
      artist: searchMetadata.artist?.trim() || undefined,
      releaseYear: searchMetadata.releaseYear?.trim() || undefined,
      adult: searchMetadata.adult?.[0],
      statuses: searchMetadata.statuses,
    };
    const page = metadata?.page ?? 1;
    const document = await fetchSearchPage(page, request);
    return {
      items: parseMangaList(document).map(toSearchResultItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query.trim().match(/^https?:\/\/(?:www\.)?cocomic\.co\/manga\/[^/?#]+\/?$/i)?.[0];
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

  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    const [first] = updateManager.getQueuedItems();
    if (!first) return;
    try {
      await fetchChapterList(first.mangaId);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapter.chapterId.endsWith("#lock"))
      throw new Error("This chapter is paid or locked. Unlock it on Cocomic before reading.");
    return parseChapterDetails(
      await fetchReaderPage(chapter.sourceManga.mangaId, chapter.chapterId),
      chapter,
    );
  }
}

export const Cocomic = new CocomicExtension();
