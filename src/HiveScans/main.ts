/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  DiscoverSectionType,
  URL,
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

import { HiveScansAdvancedSearchForm } from "./forms/search";
import { getShowLockedChapters, HiveScansSettingsForm } from "./forms/settings";
import {
  API_URL,
  PAGE_SIZE,
  SECTION_GENRES,
  SECTION_HOT,
  SECTION_NEW,
  SECTION_NOVELS,
  SECTION_POPULAR,
  SORTING_OPTIONS,
  type HiveScansChapterResponse,
  type HiveScansPostDetailsResponse,
  type HiveScansPost,
  type HiveScansSearchResponse,
  type OptionItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchGenres, fetchJSON, HiveScansInterceptor } from "./network";
import {
  contentRatingForGenres,
  decodeMangaId,
  encodeMangaId,
  isNovel,
  normalizeSearchTerm,
  parseChapterDetails,
  parseChapterList,
  parseMangaDetails,
  parseSearchResults,
  toFeaturedItems,
  toHotReleaseItems,
  toLatestUpdateItems,
  toNovelItems,
} from "./parsers";
import type HiveScansConfig from "./pbconfig";

export class HiveScansExtension implements ExtensionImpl<typeof HiveScansConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new HiveScansInterceptor("main");

  private genresPromise?: Promise<OptionItem[]>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new HiveScansSettingsForm();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.genresPromise = undefined;
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

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      { id: SECTION_NOVELS, title: "Top Novels", type: DiscoverSectionType.prominentCarousel },
      { id: SECTION_HOT, title: "Hot Releases", type: DiscoverSectionType.prominentCarousel },
      { id: SECTION_NEW, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_GENRES) {
      const genres = await (this.genresPromise ??= fetchGenres().then((items) =>
        items.map((item) => ({ id: item.id, value: item.title })),
      ));
      const items: DiscoverSectionItem[] = genres.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.value,
        searchQuery: {
          title: "",
          metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
        },
        contentRating: contentRatingForGenres([genre.value]),
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === SECTION_POPULAR) {
      const url = new URL(API_URL)
        .addPathComponent("query")
        .setQueryItem("page", "1")
        .setQueryItem("perPage", PAGE_SIZE.toString())
        .setQueryItem("searchTerm", "")
        .setQueryItem("orderBy", "totalViews")
        .toString();
      const data = await fetchJSON<HiveScansSearchResponse>({ url, method: "GET" });
      const posts = (data.posts ?? []).filter((post) => !isNovel(post)).slice(0, 8);
      const details = await Promise.all(
        posts.map(async (post) => (await this.fetchPostDetails(encodeMangaId(post.slug))).post),
      );
      return { items: toFeaturedItems(details), metadata: undefined };
    }

    if (section.id === SECTION_NOVELS) {
      const url = new URL(API_URL)
        .addPathComponent("query")
        .setQueryItem("page", "1")
        .setQueryItem("perPage", "4")
        .setQueryItem("searchTerm", "")
        .setQueryItem("seriesType", "NOVEL")
        .setQueryItem("orderBy", "totalViews")
        .setQueryItem("orderDirection", "desc")
        .toString();
      const data = await fetchJSON<HiveScansSearchResponse>({ url, method: "GET" });
      return { items: toNovelItems(data.posts ?? []), metadata: undefined };
    }

    if (section.id !== SECTION_HOT && section.id !== SECTION_NEW) {
      return { items: [], metadata: undefined };
    }

    const page = metadata?.page ?? 1;
    const url = new URL(API_URL)
      .addPathComponent("posts")
      .setQueryItem("page", page.toString())
      .setQueryItem("perPage", PAGE_SIZE.toString())
      .setQueryItem("searchTerm", "")
      .setQueryItem("tag", section.id)
      .toString();

    const data = await fetchJSON<HiveScansSearchResponse>({ url, method: "GET" });
    const items =
      section.id === SECTION_HOT
        ? toHotReleaseItems(data.posts ?? [])
        : toLatestUpdateItems(data.posts ?? []);

    const hasNextPage = data.totalCount > page * PAGE_SIZE;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    const genres = await (this.genresPromise ??= fetchGenres().then((items) =>
      items.map((item) => ({ id: item.id, value: item.title })),
    ));
    return new HiveScansAdvancedSearchForm(query, genres);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const excludedGenreIds = new Set(
      Object.entries(query.metadata?.genres ?? {})
        .filter(([, state]) => state === "excluded")
        .map(([id]) => id),
    );

    if (excludedGenreIds.size === 0) {
      const page = metadata?.page ?? 1;
      const data = await this.fetchSearchPage(query, sortingOption, page);
      const items = parseSearchResults(data.posts ?? []);
      const hasNextPage = data.totalCount > page * PAGE_SIZE;

      return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
    }

    const posts: HiveScansPost[] = [];
    let apiPage = metadata?.apiPage ?? 1;
    let apiOffset = metadata?.apiOffset ?? 0;
    let nextMetadata: PageMetadata | undefined;

    while (posts.length < PAGE_SIZE) {
      const data = await this.fetchSearchPage(query, sortingOption, apiPage);
      const pagePosts = data.posts ?? [];

      while (apiOffset < pagePosts.length && posts.length < PAGE_SIZE) {
        const post = pagePosts[apiOffset++];
        if (
          !post ||
          (post.genres ?? []).some((genre) => excludedGenreIds.has(genre.id.toString()))
        ) {
          continue;
        }
        posts.push(post);
      }

      const hasNextApiPage = data.totalCount > apiPage * PAGE_SIZE;
      if (posts.length === PAGE_SIZE) {
        nextMetadata =
          apiOffset < pagePosts.length
            ? { apiPage, apiOffset }
            : hasNextApiPage
              ? { apiPage: apiPage + 1, apiOffset: 0 }
              : undefined;
        break;
      }
      if (!hasNextApiPage) break;

      apiPage += 1;
      apiOffset = 0;
    }

    return { items: parseSearchResults(posts), metadata: nextMetadata };
  }

  private async fetchSearchPage(
    query: SearchQuery<SearchMetadata>,
    sortingOption: SortingOption | undefined,
    page: number,
  ): Promise<HiveScansSearchResponse> {
    const searchTerm = normalizeSearchTerm(query.title ?? "");

    const builder = new URL(API_URL)
      .addPathComponent("query")
      .setQueryItem("page", page.toString())
      .setQueryItem("perPage", PAGE_SIZE.toString())
      .setQueryItem("searchTerm", searchTerm);

    if (sortingOption?.id) builder.setQueryItem("orderBy", sortingOption.id);

    const meta = query.metadata;
    if (meta?.status?.[0]) builder.setQueryItem("seriesStatus", meta.status[0]);
    if (meta?.type?.[0]) builder.setQueryItem("seriesType", meta.type[0]);
    if (meta?.direction?.[0]) builder.setQueryItem("orderDirection", meta.direction[0]);

    const genres = Object.entries(meta?.genres ?? {});
    const includeIds = genres.filter(([, state]) => state === "included").map(([id]) => id);
    if (includeIds.length > 0) builder.setQueryItem("genreIds", includeIds.join(","));

    return fetchJSON<HiveScansSearchResponse>({
      url: builder.toString(),
      method: "GET",
    });
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const match = query.trim().match(/^https?:\/\/(?:www\.)?hivetoons\.org\/series\/([^/?#]+)/i);
    const slug = match?.[1];
    if (!slug) return undefined;

    const manga = await this.getMangaDetails(encodeMangaId(decodeURIComponent(slug)));
    return {
      items: [
        {
          mangaId: manga.mangaId,
          title: manga.mangaInfo.primaryTitle,
          imageUrl: manga.mangaInfo.thumbnailUrl,
          contentRating: manga.mangaInfo.contentRating,
        },
      ],
      metadata: undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const data = await this.fetchPostDetails(mangaId);
    return parseMangaDetails(data.post);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const data = await this.fetchPostDetails(sourceManga.mangaId);
    return parseChapterList(data.post.chapters ?? [], sourceManga, getShowLockedChapters());
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URL(API_URL)
      .addPathComponent("chapter")
      .setQueryItem("chapterId", chapter.chapterId)
      .toString();

    const data = await fetchJSON<HiveScansChapterResponse>({ url, method: "GET" });
    if (!data.chapter) {
      throw new Error(`No chapter data returned for chapter ${chapter.chapterId}`);
    }
    return parseChapterDetails(data.chapter, chapter);
  }

  private async fetchPostDetails(mangaId: string): Promise<HiveScansPostDetailsResponse> {
    const slug = decodeMangaId(mangaId);
    const url = new URL(API_URL).addPathComponent("post").setQueryItem("postSlug", slug).toString();
    return fetchJSON<HiveScansPostDetailsResponse>({ url, method: "GET" });
  }
}

export const HiveScans = new HiveScansExtension();
