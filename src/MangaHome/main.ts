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
import type * as cheerio from "cheerio";

import { MangaHomeAdvancedSearchForm } from "./forms";
import {
  AWESOME_TAB_INDEX,
  HOME_TITLES,
  RANK_TITLES,
  SECTIONS,
  SORT_OPTIONS,
  SORT_TOKENS,
  type MangaListItem,
  type PageMetadata,
  type SearchMetadata,
  type SearchRequest,
} from "./models";
import {
  chapterUrl,
  fetchDocument,
  homeUrl,
  listingUrl,
  MangaHomeInterceptor,
  mangaUrl,
  rankUrl,
  searchUrl,
} from "./network";
import {
  buildSequentialImageUrls,
  parseChapterPageUrls,
  parseChapters,
  parseFeelingSection,
  parseHasNextPage,
  parseMangaDetails,
  parseMangaList,
  parseRankSection,
  parseRecommendList,
  parseViewerImage,
  toChapterUpdateItem,
  toFeaturedItem,
  toRankedItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type MangaHomeConfig from "./pbconfig";

export class MangaHomeExtension implements ExtensionImpl<typeof MangaHomeConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 4,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new MangaHomeInterceptor("main");

  // Four carousels come from the home page and two from the ranking page; share
  // each in-flight fetch so a refresh burst stays at one request per document.
  private homePromise?: Promise<cheerio.CheerioAPI>;
  private rankPromise?: Promise<cheerio.CheerioAPI>;

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
    this.rankPromise = undefined;
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    Application.invalidateDiscoverSections();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.FEATURED, title: "Featured Manga", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.HOT_YAOI,
        title: "Hot Yaoi Manga Releases",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.NEW_SHOUJO,
        title: "New Shoujo Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.LATEST, title: "Latest Releases", type: DiscoverSectionType.chapterUpdates },
      {
        id: SECTIONS.TOP_SHOUJO_WEEK,
        title: "Top Shoujo This Week",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.COMPLETED_SHOUJO,
        title: "Completed Shoujo Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.TOP_VIEWED_SHOUJO,
        title: "Top Viewed Shoujo",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.TOP_RATED_SHOUJO,
        title: "Top Rated Shoujo",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.MOST_VIEWED_YAOI,
        title: "Most Viewed Yaoi",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.TOP_YAOI_WEEK,
        title: "Top Yaoi This Week",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.AWESOME,
        title: "Awesome Ranking",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED:
        return { items: (await this.getRecommended(HOME_TITLES.FEATURED)).map(toFeaturedItem) };
      case SECTIONS.HOT_YAOI:
        return { items: (await this.getRecommended(HOME_TITLES.HOT_YAOI)).map(toSimpleItem) };
      case SECTIONS.NEW_SHOUJO:
        return { items: (await this.getRecommended(HOME_TITLES.NEW_SHOUJO)).map(toSimpleItem) };
      case SECTIONS.LATEST:
        return this.getLatestSection(metadata);
      case SECTIONS.TOP_SHOUJO_WEEK:
        return { items: (await this.getRanked(RANK_TITLES.SHOUJO)).map(toFeaturedItem) };
      case SECTIONS.COMPLETED_SHOUJO:
        return {
          items: (await this.getRecommended(HOME_TITLES.COMPLETED_SHOUJO)).map(toSimpleItem),
        };
      case SECTIONS.TOP_VIEWED_SHOUJO:
        return this.getDirectorySection("shoujo", "views", metadata);
      case SECTIONS.TOP_RATED_SHOUJO:
        return this.getDirectorySection("shoujo", "rating", metadata);
      case SECTIONS.MOST_VIEWED_YAOI:
        return this.getDirectorySection("yaoi", "views", metadata);
      case SECTIONS.TOP_YAOI_WEEK:
        return { items: (await this.getRanked(RANK_TITLES.YAOI)).map(toRankedItem) };
      case SECTIONS.AWESOME:
        return {
          items: parseFeelingSection(await this.getRank(), AWESOME_TAB_INDEX).map(toRankedItem),
        };
      default:
        return { items: [] };
    }
  }

  private async getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchDocument(listingUrl("latest", page));
    return {
      items: parseMangaList($).flatMap((item) => {
        const card = toChapterUpdateItem(item);
        return card ? [card] : [];
      }),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private async getDirectorySection(
    path: string,
    sort: string,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchDocument(listingUrl(path, page, SORT_TOKENS[sort]));
    return {
      items: parseMangaList($).map(toFeaturedItem),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private async getRecommended(heading: string): Promise<MangaListItem[]> {
    return parseRecommendList(await this.getHome(), heading);
  }

  private async getRanked(heading: string): Promise<MangaListItem[]> {
    return parseRankSection(await this.getRank(), heading);
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MangaHomeAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const request = this.buildSearchRequest(query);
    const isFiltered = Object.values(request).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    );

    // The advanced-search endpoint has no ordering of its own, so an unfiltered
    // browse goes through the directory instead, where the sort tabs apply.
    const $ = await fetchDocument(
      isFiltered
        ? searchUrl(page, request)
        : listingUrl("shoujo", page, SORT_TOKENS[sortingOption?.id ?? "views"]),
    );

    return {
      items: parseMangaList($).map(toSearchResultItem),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchRequest(query: SearchQuery<SearchMetadata>): SearchRequest {
    const metadata = query.metadata ?? {};
    const genres = Object.entries(metadata.genres ?? {});
    return {
      name: (query.title ?? "").trim() || undefined,
      nameMethod: metadata.nameMatch?.[0],
      author: metadata.author,
      authorMethod: metadata.authorMatch?.[0],
      artist: metadata.artist,
      artistMethod: metadata.artistMatch?.[0],
      type: metadata.type?.[0],
      includedGenres: genres.filter(([, state]) => state === "included").map(([id]) => id),
      excludedGenres: genres.filter(([, state]) => state === "excluded").map(([id]) => id),
      released: metadata.released,
      releasedMethod: metadata.releasedMatch?.[0],
      rating: metadata.rating?.[0],
      ratingMethod: metadata.ratingMatch?.[0],
      isCompleted: metadata.completed?.[0],
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const mangaId = /^https?:\/\/(?:www\.)?mangahome\.com\/manga\/([^/?#]+)/i.exec(
      query.trim(),
    )?.[1];
    if (!mangaId) return undefined;

    const manga = await this.getMangaDetails(mangaId);
    return {
      items: [
        {
          mangaId: manga.mangaId,
          title: manga.mangaInfo.primaryTitle,
          imageUrl: manga.mangaInfo.thumbnailUrl,
          contentRating: manga.mangaInfo.contentRating,
        },
      ],
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchDocument(mangaUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchDocument(mangaUrl(sourceManga.mangaId)), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const firstUrl = chapterUrl(chapter.sourceManga.mangaId, chapter.chapterId);
    const $ = await fetchDocument(firstUrl);
    const pageUrls = parseChapterPageUrls($);
    const firstImage = parseViewerImage($);

    if (!firstImage) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    }

    // Chapter images share one directory and a zero-padded index, so the whole
    // chapter can be derived from the first page instead of loading each one.
    const total = Math.max(pageUrls.length, 1);
    const pages = buildSequentialImageUrls(firstImage, 1, total) ?? [firstImage];

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  private getHome(): Promise<cheerio.CheerioAPI> {
    this.homePromise ??= fetchDocument(homeUrl()).finally(() => {
      this.homePromise = undefined;
    });
    return this.homePromise;
  }

  private getRank(): Promise<cheerio.CheerioAPI> {
    this.rankPromise ??= fetchDocument(rankUrl()).finally(() => {
      this.rankPromise = undefined;
    });
    return this.rankPromise;
  }
}

export const MangaHome = new MangaHomeExtension();
