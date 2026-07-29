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
  CONTENT_TYPE_OPTIONS,
  PAGE_SIZE,
  PERIOD_OPTIONS,
  SECTIONS,
  SORT_OPTIONS,
  type ContentType,
  type PageMetadata,
  type SearchMetadata,
  type Series,
  type TriState,
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

const contentTypeFilterId = (contentType: ContentType): string =>
  contentType === "novel" ? "novels" : "manhwa-manga";

const contentTypeFromFilter = (value?: string): ContentType | undefined => {
  switch (value) {
    case "novel":
    case "novels":
      return "novel";
    case "manhwa":
    case "manhwa-manga":
      return "manhwa";
    default:
      return undefined;
  }
};

const statusFromFilter = (value?: string): string | undefined => {
  switch (value) {
    case "in-process":
    case "ongoing":
      return "ongoing";
    case "completed":
    case "hiatus":
      return value;
    default:
      return undefined;
  }
};

const pickState = (value: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.entries(value ?? {})
    .filter(([, current]) => current === state)
    .map(([id]) => id);

const normalizedGenre = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

const seriesMatchesFilters = (series: Series, metadata: SearchMetadata): boolean => {
  const typeId = contentTypeFilterId(series.contentType === "novel" ? "novel" : "manhwa");
  const includedTypes = pickState(metadata.contentType, "included");
  const excludedTypes = pickState(metadata.contentType, "excluded");
  if (includedTypes.length > 0 && !includedTypes.includes(typeId)) return false;
  if (excludedTypes.includes(typeId)) return false;

  const status = (series.publicationStatus ?? "").toLowerCase();
  const statusId = status.includes("complete")
    ? "completed"
    : status.includes("hiatus")
      ? "hiatus"
      : "in-process";
  const includedStatuses = pickState(metadata.status, "included");
  const excludedStatuses = pickState(metadata.status, "excluded");
  if (includedStatuses.length > 0 && !includedStatuses.includes(statusId)) return false;
  if (excludedStatuses.includes(statusId)) return false;

  const genres = new Set((series.genres ?? []).map(normalizedGenre));
  const includedGenres = pickState(metadata.genres, "included");
  const excludedGenres = pickState(metadata.genres, "excluded");
  if (includedGenres.some((genre) => !genres.has(normalizedGenre(genre)))) return false;
  return !excludedGenres.some((genre) => genres.has(normalizedGenre(genre)));
};

class StoneScapeExtension implements ExtensionImpl<typeof StoneScapeConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
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
    const banner = await fetchBanner(contentType);
    if (contentType === "novel" && banner.showNovelSection === false) return { items: [] };

    return {
      items: parseMangaList(banner.featuredSeries)
        .filter((item) => item.imageUrl.length > 0)
        .map(toFeaturedItem),
    };
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
              contentType: { [contentTypeFilterId(contentType)]: "included" },
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
        if (
          !item ||
          !("imageUrl" in item) ||
          typeof item.imageUrl !== "string" ||
          !/^https?:\/\/\S+$/i.test(item.imageUrl)
        ) {
          return [];
        }
        return [item];
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
    const includedContentTypes = pickState(searchMetadata.contentType, "included");
    const excludedContentTypes = pickState(searchMetadata.contentType, "excluded");
    const selectedContentType =
      includedContentTypes.length === 1 && excludedContentTypes.length === 0
        ? contentTypeFromFilter(includedContentTypes[0])
        : undefined;

    if (searchMetadata.popularPeriod && selectedContentType) {
      const popular = await fetchPopular(
        searchMetadata.popularPeriod,
        selectedContentType,
        PAGE_SIZE,
      );
      return { items: parseMangaList(popular.data).map(toSearchResultItem) };
    }

    const page = metadata?.page ?? 1;
    const allContentTypes = CONTENT_TYPE_OPTIONS.map((option) => option.id);
    const selectedTypeIds =
      includedContentTypes.length > 0
        ? includedContentTypes
        : excludedContentTypes.length > 0
          ? allContentTypes.filter((id) => !excludedContentTypes.includes(id))
          : [];
    if (selectedTypeIds.length === 0 && excludedContentTypes.length > 0) return { items: [] };

    const includedStatuses = pickState(searchMetadata.status, "included");
    const excludedStatuses = pickState(searchMetadata.status, "excluded");
    const serverStatus =
      includedStatuses.length === 1 && excludedStatuses.length === 0
        ? statusFromFilter(includedStatuses[0])
        : undefined;
    const includedGenres = pickState(searchMetadata.genres, "included");
    const requestTypes =
      selectedTypeIds.length === 1 ? [contentTypeFromFilter(selectedTypeIds[0])] : [undefined];
    const responses = await Promise.all(
      requestTypes.map((contentType) =>
        fetchSeries({
          page,
          limit: PAGE_SIZE,
          contentType,
          genres: includedGenres,
          status: serverStatus,
          search: (query.title ?? "").trim() || undefined,
          sort: sortingOption?.id,
        }),
      ),
    );
    const seen = new Set<string>();
    const series = responses
      .flatMap((response) => response.data)
      .filter((item) => {
        if (seen.has(item.seriesId) || !seriesMatchesFilters(item, searchMetadata)) return false;
        seen.add(item.seriesId);
        return true;
      });
    return {
      items: parseMangaList(series).map(toSearchResultItem),
      metadata: responses.some((response) => page < response.pagination.totalPages)
        ? { page: page + 1 }
        : undefined,
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
    const response = await fetchChapters(slug);
    return parseChapterList(
      response.chapters,
      sourceManga,
      sourceManga.mangaInfo.contentType === "novel" ? "novel" : "manhwa",
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
