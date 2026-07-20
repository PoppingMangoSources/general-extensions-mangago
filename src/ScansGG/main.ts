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
  POPULAR_FETCH_SIZE,
  POPULAR_RANGE_OPTIONS,
  SERIES_PAGE_SIZE,
  TAG_OPTIONS,
  type ChapterDto,
  type Metadata,
  type PageListDto,
  type PopularRange,
  type SearchMetadata,
  type SeriesDto,
} from "./models";
import { fetchApi, ScansGGInterceptor, type QueryValue } from "./network";
import {
  numericSeriesId,
  parseChapterList,
  parseChapterPages,
  parseMangaDetails,
  parseReaderPagePaths,
  toFeaturedItem,
  toLatestItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type ScansGGConfig from "./pbconfig";
import {
  getContentFilters,
  getSelectedIds,
  isGenreVisible,
  seriesMatchesFilters,
} from "./utils/filters";
import { pageListViaWebView } from "./utils/webView";

const SECTION_POPULAR = "popular";
const SECTION_POPULAR_RANGES = "popular_ranges";
const SECTION_LATEST = "latest";
const SECTION_ALL_SERIES = "all_series";
const SECTION_GENRES = "genres";

// Guards the chapter-pagination loop against a misbehaving `has_more` flag.
const MAX_CHAPTER_PAGES = 200;
// Avoid an unbounded scan when a combination of local exclusions is very narrow.
const MAX_FILTER_BATCHES = 10;

// Paperback rejects an empty image URL and fails the whole carousel, so drop
// any card that ended up without a cover rather than break the section.
function hasImage(item: DiscoverSectionItem): boolean {
  return "imageUrl" in item && item.imageUrl.length > 0;
}

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

  // ----------------------------------------------------------------
  // Discover
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      {
        id: SECTION_POPULAR_RANGES,
        title: "Most Popular",
        type: DiscoverSectionType.genres,
      },
      { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION_ALL_SERIES, title: "All Series", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  // The homepage uses `/series` for popular/all-series and `/chapters` for its
  // update feed. Keep those request shapes aligned with the website so group
  // and timeframe metadata stay available.
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const contentFilters = getContentFilters();

    if (section.id === SECTION_GENRES) {
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

    if (section.id === SECTION_POPULAR_RANGES) {
      const items: DiscoverSectionItem[] = POPULAR_RANGE_OPTIONS.map((range) => ({
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

    if (section.id === SECTION_POPULAR) {
      // Keep the original full Popular carousel. The site's timeframe endpoint
      // is only a seven-card preview and becomes much smaller after SFW and
      // hidden-genre filtering.
      const page = await this.fetchFilteredSeries(
        metadata,
        {
          chapters: true,
          group_details: true,
          collab_groups_details: true,
        },
        (series) =>
          Boolean(series.cover) && seriesMatchesFilters(series, undefined, contentFilters),
      );
      return {
        items: page.data.map(toFeaturedItem).filter(hasImage),
        metadata: page.metadata,
      };
    }

    if (section.id === SECTION_LATEST) {
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

    if (section.id !== SECTION_ALL_SERIES) {
      throw new Error(`Unknown discover section: ${section.id}`);
    }

    const page = await this.fetchFilteredSeries(
      metadata,
      {},
      (series) => Boolean(series.cover) && seriesMatchesFilters(series, undefined, contentFilters),
    );
    return { items: page.data.map(toSimpleItem).filter(hasImage), metadata: page.metadata };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new ScansGGAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    _sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    // Let readers paste a series link (or "id:123") straight into search.
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
        // One included tag is safe to send to the API. Multiple tags stay
        // local so the selected AND/OR mode is exact regardless of API defaults.
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

  // Resolve a pasted `scans.gg/series/<id>` URL (or `id:<id>`) to a single card.
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

  // ----------------------------------------------------------------
  // Manga details, chapters & pages
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const response = await fetchApi<SeriesDto>("series", {
      id: mangaId,
      trackers: true,
      sources: true,
    });
    if (!response.data) throw new Error(`No series data returned for id ${mangaId}.`);
    return parseMangaDetails(response.data, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters: ChapterDto[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_CHAPTER_PAGES) {
      // The chapters endpoint only accepts the bare numeric series id.
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

    return parseChapterList(chapters, sourceManga, await this.resolveSlugId(sourceManga));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const storedSeriesId = chapter.additionalInfo?.seriesId ?? chapter.sourceManga.mangaId;
    const groupId = chapter.additionalInfo?.groupId ?? "0";
    // The reader endpoints hang on bare numeric ids; upgrade old stored ids
    // to the slugged form before touching them.
    const seriesId = storedSeriesId.includes("-")
      ? storedSeriesId
      : await this.resolveSlugId(chapter.sourceManga);

    const toDetails = (pages: string[]): ChapterDetails => ({
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    });

    // The chapter backend can take close to a minute on chapters it hasn't
    // cached yet, and the transport cuts off at 60s. Run the JSON endpoint
    // and the reader page in parallel and take whichever yields pages first.
    // A group-less request (the site's own primary form, letting the server
    // pick the default release) joins the race in case the stored group's
    // data is what the backend is choking on.
    const attempts = [
      this.pagesViaApi(seriesId, chapter, groupId),
      this.pagesViaReaderHtml(seriesId, chapter, groupId),
    ];
    if (groupId !== "0") attempts.push(this.pagesViaApi(seriesId, chapter, "0"));
    try {
      return toDetails(await Promise.any(attempts));
    } catch {
      // A timed-out round still leaves the server cache warm, so one more
      // API attempt tends to answer quickly.
    }

    try {
      return toDetails(await this.pagesViaApi(seriesId, chapter, groupId));
    } catch {
      // Last resort below.
    }

    // Final fallback: render the reader in a WebView and scrape the images.
    const pages = await pageListViaWebView(
      this.readerUrl(seriesId, chapter.chapterId, groupId),
      this.cookieStorageInterceptor,
    );
    if (pages.length === 0) {
      throw new Error(`No page data returned for chapter ${chapter.chapterId}.`);
    }
    return toDetails(pages);
  }

  // The site's canonical reader URL carries the release group as `?group=`.
  private readerUrl(seriesId: string, chapterId: string, groupId: string): string {
    const groupSuffix = groupId !== "0" ? `?group=${groupId}` : "";
    return `${getDomain()}/series/${seriesId}/${chapterId}${groupSuffix}`;
  }

  private async pagesViaApi(
    seriesId: string,
    chapter: Chapter,
    groupId: string,
  ): Promise<string[]> {
    const query: Record<string, string> = {
      series_id: seriesId,
      chapter_id: chapter.chapterId,
    };
    if (groupId !== "0") query.group_id = groupId;
    const response = await fetchApi<PageListDto>("chapter-navigation", query);
    if (!response.data) {
      throw new Error(`No page data returned for chapter ${chapter.chapterId}.`);
    }
    return parseChapterPages(response.data, chapter);
  }

  // The reader page's server-rendered HTML embeds the same page list in its
  // Nuxt payload, so it doubles as a second independent source of pages.
  private async pagesViaReaderHtml(
    seriesId: string,
    chapter: Chapter,
    groupId: string,
  ): Promise<string[]> {
    const url = this.readerUrl(seriesId, chapter.chapterId, groupId);
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    if (response.status !== 200) {
      throw new Error(`Reader page failed with status ${response.status}.`);
    }
    const paths = parseReaderPagePaths(Application.arrayBufferToUTF8String(buffer));
    if (paths.length === 0) {
      throw new Error(`No pages found in the reader payload for ${chapter.chapterId}.`);
    }
    return paths.map((path) => `${CDN_URL}/pages/${chapter.chapterId}/${path}`);
  }

  // Canonical `{id}-{slug}` series id: from the manga id itself, the stored
  // details, or (for entries saved by older builds) a fresh details fetch.
  private async resolveSlugId(sourceManga: SourceManga): Promise<string> {
    if (sourceManga.mangaId.includes("-")) return sourceManga.mangaId;
    const stored = sourceManga.mangaInfo?.additionalInfo?.slugId;
    if (typeof stored === "string" && stored.includes("-")) return stored;
    try {
      const details = await this.getMangaDetails(sourceManga.mangaId);
      const slugId = details.mangaInfo.additionalInfo?.slugId;
      if (typeof slugId === "string" && slugId.length > 0) return slugId;
    } catch {
      // Fall back to whatever id we already have.
    }
    return sourceManga.mangaId;
  }
}

export const ScansGG = new ScansGGExtension();
