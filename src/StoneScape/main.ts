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
  type Tag,
} from "@paperback/types";

import { StoneScapeAdvancedSearchForm } from "./forms/search";
import { getShowLockedChapters, StoneScapeSettingsForm } from "./forms/settings";
import {
  PAGE_SIZE,
  PERIOD_OPTIONS,
  SECTIONS,
  SORT_OPTIONS,
  type ContentType,
  type PageMetadata,
  type SearchMetadata,
  type Series,
} from "./models";
import {
  fetchBanner,
  fetchChapterPages,
  fetchChapters,
  fetchGenres,
  fetchNovelChapter,
  fetchPopular,
  fetchSeries,
  fetchSeriesDetails,
  StoneScapeInterceptor,
} from "./network";
import {
  contentRatingForGenres,
  decodeChapterId,
  decodeMangaId,
  parseChapterList,
  parseChapterPages,
  parseMangaDetails,
  parseMangaList,
  parseNovelChapter,
  toChapterUpdateItem,
  toFeaturedItem,
  toSearchResultItem,
} from "./parsers";
import type StoneScapeConfig from "./pbconfig";

class StoneScapeExtension implements ExtensionImpl<typeof StoneScapeConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 6,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new StoneScapeInterceptor("main");
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
    this.genresPromise = undefined;
  }

  async getSettingsForm(): Promise<Form> {
    return new StoneScapeSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.FEATURED, title: "Featured Series", type: DiscoverSectionType.featured },
      { id: SECTIONS.POPULAR, title: "Popular Series", type: DiscoverSectionType.genres },
      {
        id: SECTIONS.LATEST,
        title: "Latest Releases",
        type: DiscoverSectionType.chapterUpdates,
      },
      { id: SECTIONS.NOVELS, title: "Novels", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.LATEST_NOVELS,
        title: "Latest Novels",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: SECTIONS.POPULAR_NOVELS,
        title: "Popular Novels",
        type: DiscoverSectionType.genres,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED:
        return this.getFeaturedSection("manhwa");
      case SECTIONS.POPULAR:
        return this.getPopularPeriodSection("manhwa");
      case SECTIONS.LATEST:
        return this.getLatestSection("manhwa");
      case SECTIONS.NOVELS:
        return this.getFeaturedSection("novel");
      case SECTIONS.LATEST_NOVELS:
        return this.getLatestSection("novel");
      case SECTIONS.POPULAR_NOVELS:
        return this.getPopularPeriodSection("novel");
      case SECTIONS.GENRES:
        return this.getGenresSection();
      default:
        return { items: [] };
    }
  }

  private async getFeaturedSection(
    contentType: ContentType,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const [banner, catalog, popular] = await Promise.all([
      fetchBanner(contentType),
      fetchSeries({ page: 1, limit: 100, contentType }),
      fetchPopular("year", contentType, 100),
    ]);
    if (contentType === "novel" && banner.showNovelSection === false) return { items: [] };

    const catalogBySlug = new Map(catalog.data.map((series) => [series.slug, series]));
    const popularBySlug = new Map(popular.data.map((series) => [series.slug, series]));
    const enriched = banner.featuredSeries.map((series): Series => {
      const popularSeries = popularBySlug.get(series.slug);
      return {
        ...popularSeries,
        ...catalogBySlug.get(series.slug),
        ...series,
        totalViews: popularSeries?.totalViews,
      };
    });
    return { items: parseMangaList(enriched).map(toFeaturedItem) };
  }

  private getPopularPeriodSection(contentType: ContentType): PagedResults<DiscoverSectionItem> {
    return {
      items: PERIOD_OPTIONS.map(
        (period): DiscoverSectionItem => ({
          type: "genresCarouselItem",
          name: period.title,
          searchQuery: {
            title: "",
            metadata: {
              contentType: [contentType],
              popularPeriod: period.id,
            } satisfies SearchMetadata,
          },
        }),
      ),
    };
  }

  private async getLatestSection(
    contentType: ContentType,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const response = await fetchSeries({
      page: 1,
      limit: contentType === "novel" ? 8 : 12,
      contentType,
    });
    return {
      items: response.data.flatMap((series) => {
        const item = toChapterUpdateItem(series, contentType);
        return item ? [item] : [];
      }),
    };
  }

  private async getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchGenres().then((response) =>
      response.genres.map((genre) => ({ id: genre.slug, title: genre.label })),
    ));
  }

  private async getGenresSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const genres = await this.getGenres();
    return {
      items: genres.map(
        (genre): DiscoverSectionItem => ({
          type: "genresCarouselItem",
          name: genre.title,
          searchQuery: {
            title: "",
            metadata: { genres: [genre.id] } satisfies SearchMetadata,
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
    return new StoneScapeAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const searchMetadata = query.metadata ?? {};
    const selectedContentType =
      searchMetadata.contentType?.[0] === "novel"
        ? "novel"
        : searchMetadata.contentType?.[0] === "manhwa"
          ? "manhwa"
          : undefined;

    if (searchMetadata.popularPeriod && selectedContentType) {
      const [popular, catalog] = await Promise.all([
        fetchPopular(searchMetadata.popularPeriod, selectedContentType, 100),
        fetchSeries({ page: 1, limit: 100, contentType: selectedContentType }),
      ]);
      const catalogBySlug = new Map(catalog.data.map((series) => [series.slug, series]));
      const enriched = popular.data.map(
        (series): Series => ({
          ...catalogBySlug.get(series.slug),
          ...series,
        }),
      );
      return { items: parseMangaList(enriched).map(toSearchResultItem) };
    }

    const page = metadata?.page ?? 1;
    const response = await fetchSeries({
      page,
      limit: PAGE_SIZE,
      contentType: selectedContentType,
      genres: searchMetadata.genres,
      status: searchMetadata.status?.[0],
      search: (query.title ?? "").trim() || undefined,
      sort: sortingOption?.id,
    });
    return {
      items: parseMangaList(response.data).map(toSearchResultItem),
      metadata: page < response.pagination.totalPages ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const slug = query
      .trim()
      .match(/^https?:\/\/(?:www\.)?stonescape\.xyz\/series\/([^/?#]+)/i)?.[1];
    if (!slug) return undefined;

    try {
      const manga = parseMangaDetails(await fetchSeriesDetails(decodeMangaId(slug)));
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
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchSeriesDetails(decodeMangaId(mangaId)));
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = decodeMangaId(sourceManga.mangaId);
    const [series, response] = await Promise.all([fetchSeriesDetails(slug), fetchChapters(slug)]);
    return parseChapterList(
      response.chapters,
      sourceManga,
      series.contentType === "novel" ? "novel" : "manhwa",
      getShowLockedChapters(),
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const decoded = decodeChapterId(chapter.chapterId);
    if (decoded.locked) {
      throw new Error("This chapter must be unlocked on the website before it can be read.");
    }
    if (decoded.novel) {
      return parseNovelChapter(
        await fetchNovelChapter(decoded.novel.slug, decoded.novel.chapterNumber),
        chapter,
      );
    }
    if (!decoded.chapterId) throw new Error(`Invalid chapter id: ${chapter.chapterId}`);
    return parseChapterPages(await fetchChapterPages(decoded.chapterId), chapter);
  }
}

export const StoneScape = new StoneScapeExtension();
