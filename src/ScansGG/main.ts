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

import { ScansGGAdvancedSearchForm } from "./forms/search";
import { getDomain, ScansGGSettingsForm } from "./forms/settings";
import {
  CDN_URL,
  CHAPTER_PAGE_SIZE,
  LATEST_PAGE_SIZE,
  MAX_CHAPTER_PAGES,
  MAX_FILTER_BATCHES,
  POPULAR_FETCH_SIZE,
  POPULAR_RANGE_OPTIONS,
  SECTIONS,
  SERIES_PAGE_SIZE,
  TAG_OPTIONS,
  TOP_MANGA_SIZE,
  type ChapterDto,
  type Metadata,
  type PageListDto,
  type PopularRange,
  type SearchMetadata,
  type SeriesDto,
} from "./models";
import { fetchApi, ScansGGInterceptor, type QueryValue } from "./network";
import {
  getContentFilters,
  getSelectedIds,
  hasImage,
  isGenreVisible,
  numericSeriesId,
  parseChapterId,
  parseChapterList,
  parseChapterPages,
  parseMangaDetails,
  parseReaderPagePaths,
  seriesMatchesFilters,
  toFeaturedItem,
  toLatestItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type ScansGGConfig from "./pbconfig";
import { pageListViaWebView } from "./utils/webView";

export class ScansGGExtension implements ExtensionImpl<typeof ScansGGConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  scansGGInterceptor = new ScansGGInterceptor("main");

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.scansGGInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new ScansGGSettingsForm();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
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
      { id: SECTIONS.POPULAR, title: "Top Manga", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.POPULAR_RANGES,
        title: "Most Popular",
        type: DiscoverSectionType.genres,
      },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.ALL_SERIES, title: "All Series", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const contentFilters = getContentFilters();

    if (section.id === SECTIONS.GENRES) {
      const items: DiscoverSectionItem[] = TAG_OPTIONS.filter((tag) =>
        isGenreVisible(tag.id, contentFilters),
      ).map((tag) => ({
        type: "genresCarouselItem",
        name: tag.value,
        searchQuery: {
          title: "",
          metadata: {
            tags: { [tag.id]: "included" },
            tagMatchMode: "and",
          } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === SECTIONS.POPULAR_RANGES) {
      const items: DiscoverSectionItem[] = POPULAR_RANGE_OPTIONS.filter(
        (range) => range.id !== "monthly",
      ).map((range) => ({
        type: "genresCarouselItem",
        name: range.value,
        searchQuery: {
          title: "",
          metadata: { popularRange: range.id } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === SECTIONS.POPULAR) {
      const monthly = await this.fetchPopularSeries("monthly", undefined, contentFilters);
      const enriched = await this.enrichPopularChapters(monthly.slice(0, TOP_MANGA_SIZE));
      return {
        items: enriched.map(toFeaturedItem).filter(hasImage),
        metadata: undefined,
      };
    }

    if (section.id === SECTIONS.LATEST) {
      const page = await this.fetchFilteredLatestSeries(
        metadata,
        (series) =>
          Boolean(series.cover) &&
          seriesMatchesFilters(series, undefined, contentFilters) &&
          series.chapters?.[0]?.id != null,
      );
      const items = page.data
        .map(toLatestItem)
        .filter(hasImage)
        .filter((item) => item.type === "chapterUpdatesCarouselItem");
      return { items, metadata: page.metadata };
    }

    if (section.id !== SECTIONS.ALL_SERIES) {
      throw new Error(`Unknown discover section: ${section.id}`);
    }

    const page = await this.fetchFilteredSeries(
      metadata,
      {},
      (series) => Boolean(series.cover) && seriesMatchesFilters(series, undefined, contentFilters),
    );
    return { items: page.data.map(toSimpleItem).filter(hasImage), metadata: page.metadata };
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new ScansGGAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    _sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveDirectQuery((query.title ?? "").trim());
    if (pasted) return pasted;

    const term = (query.title ?? "").trim();
    const meta = query.metadata;
    const includedTypes = getSelectedIds(meta?.types, "included");
    const includedStatuses = getSelectedIds(meta?.statuses, "included");
    const includedTags = getSelectedIds(meta?.tags, "included");
    const contentFilters = getContentFilters();

    if (meta?.popularRange && term.length === 0) {
      const popular = await this.fetchPopularSeries(meta.popularRange, meta, contentFilters);
      return {
        items: popular.map(toSearchResultItem).filter((item) => item.imageUrl.length > 0),
        metadata: undefined,
      };
    }

    const page = await this.fetchFilteredSeries(
      metadata,
      {
        q: term.length > 0 ? term : undefined,
        q_type: includedTypes.length > 0 ? includedTypes : undefined,
        q_status: includedStatuses.length > 0 ? includedStatuses : undefined,
        q_tags: includedTags.length === 1 ? includedTags : undefined,
      },
      (series) => Boolean(series.cover) && seriesMatchesFilters(series, meta, contentFilters),
    );

    return {
      items: page.data.map(toSearchResultItem).filter((item) => item.imageUrl.length > 0),
      metadata: page.metadata,
    };
  }

  private async fetchFilteredSeries(
    metadata: Metadata | undefined,
    query: Record<string, QueryValue | undefined>,
    predicate: (series: SeriesDto) => boolean,
  ): Promise<{ data: SeriesDto[]; metadata?: Metadata }> {
    const matches: SeriesDto[] = [];
    let offset = metadata?.offset ?? 0;
    let index = metadata?.index ?? 0;

    for (let batch = 0; batch < MAX_FILTER_BATCHES; batch++) {
      const response = await fetchApi<SeriesDto[]>("series", {
        limit: SERIES_PAGE_SIZE,
        offset,
        ...query,
      });
      const data = response.data ?? [];

      while (index < data.length && matches.length < SERIES_PAGE_SIZE) {
        const series = data[index];
        index++;
        if (series && predicate(series)) matches.push(series);
      }

      if (matches.length === SERIES_PAGE_SIZE) {
        if (index < data.length) return { data: matches, metadata: { offset, index } };
        return {
          data: matches,
          metadata:
            data.length === SERIES_PAGE_SIZE
              ? { offset: offset + data.length, index: 0 }
              : undefined,
        };
      }

      if (data.length < SERIES_PAGE_SIZE) return { data: matches, metadata: undefined };
      offset += data.length;
      index = 0;
    }

    return { data: matches, metadata: { offset, index } };
  }

  private async fetchPopularSeries(
    range: PopularRange,
    searchMetadata: SearchMetadata | undefined,
    contentFilters: ReturnType<typeof getContentFilters>,
  ): Promise<SeriesDto[]> {
    const response = await fetchApi<SeriesDto[]>("series", {
      popular: range,
      limit: POPULAR_FETCH_SIZE,
      chapters: true,
      group_details: true,
      collab_groups_details: true,
    });
    return (response.data ?? [])
      .filter(
        (series) =>
          Boolean(series.cover) && seriesMatchesFilters(series, searchMetadata, contentFilters),
      )
      .slice(0, SERIES_PAGE_SIZE);
  }

  private async enrichPopularChapters(seriesList: SeriesDto[]): Promise<SeriesDto[]> {
    return Promise.all(
      seriesList.map(async (series) => {
        if (series.chapters?.[0]?.group?.title) return series;
        try {
          const response = await fetchApi<ChapterDto[]>("chapters", {
            series_id: series.id,
            page: 1,
            limit: 1,
            sort: "date",
            group_details: true,
            collab_groups_details: true,
          });
          const latest = response.data?.[0];
          return latest ? { ...series, chapters: [latest] } : series;
        } catch (error) {
          if (error instanceof CloudflareError) throw error;
          return series;
        }
      }),
    );
  }

  private async fetchFilteredLatestSeries(
    metadata: Metadata | undefined,
    predicate: (series: SeriesDto) => boolean,
  ): Promise<{ data: SeriesDto[]; metadata?: Metadata }> {
    const matches: SeriesDto[] = [];
    let page = metadata?.page ?? 1;
    let index = metadata?.index ?? 0;

    for (let batch = 0; batch < MAX_FILTER_BATCHES; batch++) {
      const response = await fetchApi<SeriesDto[]>("chapters", {
        page,
        limit: LATEST_PAGE_SIZE,
        chapters: true,
        series_details: true,
        group_details: true,
        collab_groups_details: true,
        sort: "date",
      });
      const data = response.data ?? [];
      const hasMore = response.meta?.has_more === true || data.length === LATEST_PAGE_SIZE;

      while (index < data.length && matches.length < LATEST_PAGE_SIZE) {
        const series = data[index];
        index++;
        if (series && predicate(series)) matches.push(series);
      }

      if (matches.length === LATEST_PAGE_SIZE) {
        if (index < data.length) return { data: matches, metadata: { page, index } };
        return {
          data: matches,
          metadata: hasMore ? { page: page + 1, index: 0 } : undefined,
        };
      }

      if (!hasMore) return { data: matches, metadata: undefined };
      page++;
      index = 0;
    }

    return { data: matches, metadata: { page, index } };
  }

  private async resolveDirectQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    let id: string | undefined;
    const urlMatch = query.match(/^https?:\/\/[^/]*scans\.gg\/series\/(\d[^/?#]*)/i);
    if (urlMatch) {
      try {
        id = decodeURIComponent(urlMatch[1]);
      } catch {
        return undefined;
      }
    } else if (/^id:\d+$/i.test(query)) {
      id = query.slice(3).trim();
    }
    if (!id) return undefined;

    try {
      const response = await fetchApi<SeriesDto>("series", {
        id,
        trackers: true,
        sources: true,
      });
      if (!response.data) return undefined;
      if (!seriesMatchesFilters(response.data, undefined, getContentFilters())) {
        return { items: [], metadata: undefined };
      }
      const item = toSearchResultItem(response.data);
      return {
        items: item.imageUrl.length > 0 ? [item] : [],
        metadata: undefined,
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const response = await fetchApi<SeriesDto>("series", {
      id: mangaId,
      trackers: true,
      sources: true,
    });
    if (!response.data) throw new Error(`No series data returned for id ${mangaId}.`);
    return parseMangaDetails(response.data);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters: ChapterDto[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_CHAPTER_PAGES) {
      const response = await fetchApi<ChapterDto[]>("chapters", {
        series_id: numericSeriesId(sourceManga.mangaId),
        limit: CHAPTER_PAGE_SIZE,
        page,
        group_details: true,
      });
      const batch = response.data ?? [];
      chapters.push(...batch);
      hasMore = response.meta?.has_more === true && batch.length > 0;
      page++;
    }

    return parseChapterList(chapters, sourceManga, numericSeriesId(sourceManga.mangaId));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { seriesId, chapterId, groupId } = parseChapterId(chapter.chapterId);

    const toDetails = (pages: string[]): ChapterDetails => ({
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    });

    const attempts = [
      this.pagesViaApi(seriesId, chapterId, groupId),
      this.pagesViaReaderHtml(seriesId, chapterId, groupId),
    ];
    if (groupId !== "0") attempts.push(this.pagesViaApi(seriesId, chapterId, "0"));
    try {
      return toDetails(await Promise.any(attempts));
    } catch {}

    try {
      return toDetails(await this.pagesViaApi(seriesId, chapterId, groupId));
    } catch {}

    const pages = await pageListViaWebView(
      this.readerUrl(seriesId, chapterId, groupId),
      this.cookieStorageInterceptor,
    );
    if (pages.length === 0) {
      throw new Error(`No page data returned for chapter ${chapter.chapterId}.`);
    }
    return toDetails(pages);
  }

  private readerUrl(seriesId: string, chapterId: string, groupId: string): string {
    const groupSuffix = groupId !== "0" ? `?group=${groupId}` : "";
    return `${getDomain()}/series/${seriesId}/${chapterId}${groupSuffix}`;
  }

  private async pagesViaApi(
    seriesId: string,
    chapterId: string,
    groupId: string,
  ): Promise<string[]> {
    const query: Record<string, string> = {
      series_id: seriesId,
      chapter_id: chapterId,
    };
    if (groupId !== "0") query.group_id = groupId;
    const response = await fetchApi<PageListDto>("chapter-navigation", query);
    if (!response.data) {
      throw new Error(`No page data returned for chapter ${chapterId}.`);
    }
    return parseChapterPages(response.data, chapterId);
  }

  private async pagesViaReaderHtml(
    seriesId: string,
    chapterId: string,
    groupId: string,
  ): Promise<string[]> {
    const url = this.readerUrl(seriesId, chapterId, groupId);
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    if (response.status !== 200) {
      throw new Error(`Reader page failed with status ${response.status}.`);
    }
    const paths = parseReaderPagePaths(Application.arrayBufferToUTF8String(buffer));
    if (paths.length === 0) {
      throw new Error(`No pages found in the reader payload for ${chapterId}.`);
    }
    return paths.map((path) => `${CDN_URL}/pages/${chapterId}/${path}`);
  }
}

export const ScansGG = new ScansGGExtension();
