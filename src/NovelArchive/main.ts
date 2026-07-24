/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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

import {
  getDefaultAiMode,
  getDefaultGenres,
  getHideAdultContent,
  NovelArchiveAdvancedSearchForm,
  NovelArchiveSettingsForm,
} from "./forms";
import {
  ADULT_EXCLUSIONS,
  API_URL,
  GENRES,
  PAGE_SIZE,
  SECTIONS,
  SORT_OPTIONS,
  type ChapterContentResponse,
  type Novel,
  type NovelListResponse,
  type NovelSource,
  type PageMetadata,
  type SearchMetadata,
  type SourceChapterContentResponse,
  type SourceChapterEntry,
  type SourceChapterListResponse,
  type SourceListResponse,
} from "./models";
import { fetchJSON, NovelArchiveInterceptor } from "./network";
import {
  decodeId,
  dedupe,
  encodeId,
  parseChapterDetails,
  parseChapters,
  parseMangaDetails,
  parseSourceChapterDetails,
  parseSourceChapters,
  toCardItems,
  pickGenreValues,
  toChapterUpdateItems,
  toFeaturedItems,
  toSearchResultItem,
} from "./parsers";
import type NovelArchiveConfig from "./pbconfig";

export class NovelArchiveExtension implements ExtensionImpl<typeof NovelArchiveConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 20,
    bufferInterval: 10,
    ignoreImages: true,
  });
  private interceptor = new NovelArchiveInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });

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
    this.novelRequest = undefined;
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
    return new NovelArchiveSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.featured },
      { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.EDITORS, title: "Editor's Choice", type: DiscoverSectionType.featured },
      { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.MOST_CHAPTERS,
        title: "Most Chapters",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.value }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.TRENDING:
        return this.getFeaturedItems(`${API_URL}/novels/trending?limit=11`, "trending");
      case SECTIONS.EDITORS:
        return this.getFeaturedItems(`${API_URL}/novels/editors-choice?limit=15`, "editors");
      case SECTIONS.LATEST:
        return this.getLatestSection();
      case SECTIONS.POPULAR:
        return this.getCardItems("popular", "rating", metadata);
      case SECTIONS.TOP_RATED:
        return this.getCardItems("rating", "rating", metadata);
      case SECTIONS.MOST_CHAPTERS:
        return this.getCardItems("chapters", "chapters", metadata);
      case SECTIONS.GENRES:
        return { items: this.genreCarouselItems(), metadata: undefined };
      default:
        return { items: [], metadata: undefined };
    }
  }

  private async getLatestSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const novels = await this.fetchNovelArray(`${API_URL}/novels/recently-updated?limit=30`);
    return { items: toChapterUpdateItems(novels), metadata: undefined };
  }

  private async getFeaturedItems(
    url: string,
    variant: "trending" | "editors",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const novels = await this.fetchNovelArray(url);
    return { items: toFeaturedItems(novels, variant), metadata: undefined };
  }

  private async getCardItems(
    sort: string,
    variant: "rating" | "chapters",
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const { novels, hasNext } = await this.fetchBrowse(this.buildNovelsUrl({ page, sort }));
    return {
      items: toCardItems(novels, variant),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private genreCarouselItems(): DiscoverSectionItem[] {
    const hideAdult = getHideAdultContent();
    return GENRES.filter((genre) => !hideAdult || !ADULT_EXCLUSIONS.includes(genre.value)).map(
      (genre) => ({
        type: "genresCarouselItem",
        name: genre.value,
        searchQuery: {
          title: "",
          metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
        },
        metadata: undefined,
      }),
    );
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new NovelArchiveAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const meta = query.metadata;
    const search = (query.title ?? "").trim();
    const page = metadata?.page ?? 1;

    const url = this.buildNovelsUrl({
      page,
      search: search || undefined,
      sort: sortingOption?.id,
      status: meta?.status?.[0],
      ai: meta?.ai?.[0],
      genreMatch: meta?.genreMatch?.[0],
      genresInclude: pickGenreValues(meta?.genres, "included"),
      genresExclude: pickGenreValues(meta?.genres, "excluded"),
    });

    const { novels, hasNext } = await this.fetchBrowse(url);
    return {
      items: novels.map(toSearchResultItem),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const trimmed = query.trim();
    const id =
      trimmed.match(/^https?:\/\/(?:www\.)?novelarchive\.cc\/novels?\/([^/?#]+)/i)?.[1] ??
      trimmed.match(/^https?:\/\/(?:www\.)?novelarchive\.cc\/reader\?[^#]*\bnovel=([^&#]+)/i)?.[1];
    if (!id) return undefined;

    let decoded = id;
    try {
      decoded = decodeURIComponent(id);
    } catch {
      // A malformed escape in a pasted URL falls back to the raw value.
    }
    const manga = await this.getMangaDetails(encodeId(decoded));
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
    return parseMangaDetails(await this.fetchNovel(mangaId));
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = decodeId(sourceManga.mangaId);
    const [novel, sources] = await Promise.all([
      this.fetchNovel(sourceManga.mangaId),
      this.fetchSources(id),
    ]);

    const perSource = await Promise.all(
      sources.map(async (source) =>
        parseSourceChapters(source, await this.fetchSourceChapters(id, source.id), sourceManga),
      ),
    );

    return [...parseChapters(novel, sourceManga), ...perSource.flat()];
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const id = decodeId(chapter.sourceManga.mangaId);
    const separator = chapter.chapterId.lastIndexOf(":");

    if (separator >= 0) {
      const sourceId = decodeId(chapter.chapterId.slice(0, separator));
      const number = chapter.chapterId.slice(separator + 1);
      const data = await fetchJSON<SourceChapterContentResponse>({
        url: `${API_URL}/novels/${id}/sources/${sourceId}/chapters/${number}`,
        method: "GET",
      });
      return parseSourceChapterDetails(data, chapter);
    }

    const data = await fetchJSON<ChapterContentResponse>({
      url: `${API_URL}/novels/${id}/chapters/${chapter.chapterId}`,
      method: "GET",
    });
    return parseChapterDetails(data, chapter);
  }

  // Mirror listings are optional extras; their absence should not take the
  // native chapter list down with them.
  private async fetchSources(id: string): Promise<NovelSource[]> {
    try {
      const data = await fetchJSON<NovelSource[] | SourceListResponse>({
        url: `${API_URL}/novels/${id}/sources`,
        method: "GET",
      });
      return Array.isArray(data) ? data : (data.sources ?? []);
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      return [];
    }
  }

  private async fetchSourceChapters(id: string, sourceId: string): Promise<SourceChapterEntry[]> {
    try {
      const data = await fetchJSON<SourceChapterEntry[] | SourceChapterListResponse>({
        url: `${API_URL}/novels/${id}/sources/${sourceId}/chapters`,
        method: "GET",
      });
      return Array.isArray(data) ? data : (data.chapters ?? []);
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      return [];
    }
  }

  // Details and the chapter list both need the novel; sharing one in-flight
  // request keeps that to a single round trip. A failed fetch clears itself
  // so the next call retries.
  private novelRequest?: { id: string; promise: Promise<Novel> };

  private fetchNovel(mangaId: string): Promise<Novel> {
    const id = decodeId(mangaId);
    if (this.novelRequest?.id !== id) {
      const promise = fetchJSON<Novel | { novel: Novel }>({
        url: `${API_URL}/novels/${id}`,
        method: "GET",
      }).then((data) => ("novel" in data && data.novel ? data.novel : (data as Novel)));
      const entry = { id, promise };
      promise.catch(() => {
        if (this.novelRequest === entry) this.novelRequest = undefined;
      });
      this.novelRequest = entry;
    }
    return this.novelRequest.promise;
  }

  private async fetchNovelArray(url: string): Promise<Novel[]> {
    const data = await fetchJSON<Novel[] | NovelListResponse>({ url, method: "GET" });
    return Array.isArray(data) ? data : (data.novels ?? []);
  }

  private async fetchBrowse(url: string): Promise<{ novels: Novel[]; hasNext: boolean }> {
    const data = await fetchJSON<NovelListResponse>({ url, method: "GET" });
    return { novels: data.novels ?? [], hasNext: data.pagination?.has_next ?? false };
  }

  private buildNovelsUrl(opts: {
    page: number;
    search?: string;
    sort?: string;
    status?: string;
    ai?: string;
    genreMatch?: string;
    genresInclude?: string[];
    genresExclude?: string[];
  }): string {
    const url = new URL(API_URL)
      .addPathComponent("novels")
      .setQueryItem("page", opts.page.toString())
      .setQueryItem("per_page", PAGE_SIZE.toString())
      .setQueryItem("ai_generated", opts.ai ?? getDefaultAiMode());

    if (opts.search) url.setQueryItem("search", opts.search);
    if (opts.sort) url.setQueryItem("sort", opts.sort);
    if (opts.status && opts.status !== "all") url.setQueryItem("status", opts.status);
    if (opts.genreMatch) url.setQueryItem("genre_match", opts.genreMatch);

    const defaults = getDefaultGenres();
    const includes = dedupe([
      ...(opts.genresInclude ?? []),
      ...pickGenreValues(defaults, "included"),
    ]);
    if (includes.length > 0) url.setQueryItem("genres_include", includes.join(","));

    const excludes = dedupe([
      ...(opts.genresExclude ?? []),
      ...pickGenreValues(defaults, "excluded"),
      ...(getHideAdultContent() ? ADULT_EXCLUSIONS : []),
    ]);
    if (excludes.length > 0) url.setQueryItem("genres_exclude", excludes.join(","));

    return url.toString();
  }
}

export const NovelArchive = new NovelArchiveExtension();
