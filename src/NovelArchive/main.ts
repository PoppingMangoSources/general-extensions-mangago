/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  DiscoverSectionType,
  URL,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import {
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
  type PageMetadata,
  type SearchMetadata,
  type TriState,
} from "./models";
import { fetchJSON, NovelArchiveInterceptor } from "./network";
import {
  parseChapterDetails,
  parseChapters,
  parseMangaDetails,
  toCardItems,
  toChapterUpdateItems,
  toFeaturedItems,
  toSearchResultItem,
} from "./parsers";
import type NovelArchiveConfig from "./pbconfig";

const GENRE_VALUE_BY_ID = new Map(GENRES.map((genre) => [genre.id, genre.value]));

const pickGenreValues = (genres: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.entries(genres ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => GENRE_VALUE_BY_ID.get(id) ?? id);

export class NovelArchiveExtension implements ExtensionImpl<typeof NovelArchiveConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 4,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private interceptor = new NovelArchiveInterceptor("main");

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
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
      case SECTIONS.LATEST: {
        const novels = await this.fetchNovelArray(`${API_URL}/novels/recently-updated?limit=30`);
        return { items: toChapterUpdateItems(novels), metadata: undefined };
      }
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
    return GENRES.filter(
      (genre) => !hideAdult || !ADULT_EXCLUSIONS.includes(genre.value.toLowerCase()),
    ).map((genre) => ({
      type: "genresCarouselItem",
      name: genre.value,
      searchQuery: {
        title: "",
        metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
      },
      metadata: undefined,
    }));
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

    const manga = await this.getMangaDetails(decodeURIComponent(id));
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
    const novel = await this.fetchNovel(sourceManga.mangaId);
    return parseChapters(novel, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${API_URL}/novels/${chapter.sourceManga.mangaId}/chapters/${chapter.chapterId}`;
    const data = await fetchJSON<ChapterContentResponse>(url);
    return parseChapterDetails(data, chapter);
  }

  private async fetchNovel(id: string): Promise<Novel> {
    const data = await fetchJSON<Novel | { novel: Novel }>(`${API_URL}/novels/${id}`);
    return "novel" in data && data.novel ? data.novel : (data as Novel);
  }

  private async fetchNovelArray(url: string): Promise<Novel[]> {
    const data = await fetchJSON<Novel[] | NovelListResponse>(url);
    return Array.isArray(data) ? data : (data.novels ?? []);
  }

  private async fetchBrowse(url: string): Promise<{ novels: Novel[]; hasNext: boolean }> {
    const data = await fetchJSON<NovelListResponse>(url);
    return { novels: data.novels ?? [], hasNext: data.pagination?.has_next ?? false };
  }

  private buildNovelsUrl(opts: {
    page: number;
    search?: string;
    sort?: string;
    status?: string;
    genreMatch?: string;
    genresInclude?: string[];
    genresExclude?: string[];
  }): string {
    const url = new URL(API_URL)
      .addPathComponent("novels")
      .setQueryItem("page", opts.page.toString())
      .setQueryItem("per_page", PAGE_SIZE.toString())
      .setQueryItem("ai_generated", "include");

    if (opts.search) url.setQueryItem("search", opts.search);
    if (opts.sort) url.setQueryItem("sort", opts.sort);
    if (opts.status && opts.status !== "all") url.setQueryItem("status", opts.status);
    if (opts.genreMatch) url.setQueryItem("genre_match", opts.genreMatch);
    if (opts.genresInclude && opts.genresInclude.length > 0) {
      url.setQueryItem("genres_include", opts.genresInclude.join(","));
    }

    const excludes = [...(opts.genresExclude ?? [])];
    if (getHideAdultContent()) excludes.push(...ADULT_EXCLUSIONS);
    if (excludes.length > 0) url.setQueryItem("genres_exclude", excludes.join(","));

    return url.toString();
  }
}

export const NovelArchive = new NovelArchiveExtension();
