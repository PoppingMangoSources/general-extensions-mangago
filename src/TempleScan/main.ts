/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
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

import { getShowPaidChapters, TempleScanAdvancedSearchForm, TempleScanSettingsForm } from "./forms";
import {
  DISCOVER_SECTIONS,
  DOMAIN,
  PAGE_SIZE,
  PAID_CHAPTER_SUFFIX,
  RSC_KEYS_STATE,
  SECTIONS,
  SORTING_OPTIONS,
  type BrowseSeries,
  type HomeSections,
  type PageMetadata,
  type RscTable,
  type SearchMetadata,
} from "./models";
import {
  decodeRscTable,
  fetchChapterPage,
  fetchDirectory,
  fetchFeatured,
  fetchHtml,
  fetchHomePage,
  fetchSeriesPage,
  fetchTrending,
  TempleScanInterceptor,
} from "./network";
import {
  extractChunkUrls,
  mergeRscTable,
  observedKeys,
  parseChapterPages,
  parseChapters,
  parseDirectory,
  parseFeatured,
  parseHomeSections,
  parseSeriesData,
  parseTrending,
  toFeaturedItems,
  toNewSeriesItems,
  toSearchResultItem,
  toSourceManga,
  toTrendingItems,
  toTrendingSections,
  toUpdateItems,
  withFeaturedCovers,
} from "./parsers";
import type TempleScanConfig from "./pbconfig";

class TempleScanExtension implements ExtensionImpl<typeof TempleScanConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  mainInterceptor = new TempleScanInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  // The browse endpoint returns the whole directory; cache it per session.
  private directoryPromise?: Promise<BrowseSeries[]>;
  private featuredPromise?: Promise<DiscoverSectionItem[]>;
  private homePromise?: Promise<HomeSections>;
  private rscRefreshPromise?: Promise<RscTable | undefined>;

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.directoryPromise = undefined;
    this.featuredPromise = undefined;
    this.homePromise = undefined;
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
    return new TempleScanSettingsForm();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const payload = await fetchSeriesPage(mangaId);
    const data = await this.withRscTable(`${DOMAIN}/comic/${mangaId}`, payload, (table) =>
      parseSeriesData(payload, table),
    );
    return toSourceManga(data, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const payload = await fetchSeriesPage(sourceManga.mangaId);
    const data = await this.withRscTable(
      `${DOMAIN}/comic/${sourceManga.mangaId}`,
      payload,
      (table) => parseSeriesData(payload, table),
    );
    return parseChapters(data, sourceManga, getShowPaidChapters());
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapter.chapterId.endsWith(PAID_CHAPTER_SUFFIX)) {
      throw new Error("This chapter is paid. Unlock it on the website before reading.");
    }
    const payload = await fetchChapterPage(chapter.sourceManga.mangaId, chapter.chapterId);
    const url = `${DOMAIN}/comic/${chapter.sourceManga.mangaId}/${chapter.chapterId}`;
    return this.withRscTable(url, payload, (table) => parseChapterPages(payload, chapter, table));
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED:
        return { items: await this.getFeaturedItems() };
      case SECTIONS.NEW_SERIES: {
        const home = await this.getHomeSections();
        return { items: toNewSeriesItems(home.newSeries) };
      }
      case SECTIONS.LATEST: {
        const home = await this.getHomeSections();
        return { items: toUpdateItems(home.updates) };
      }
      case SECTIONS.TRENDING:
        return { items: toTrendingSections() };
      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new TempleScanAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    if (query.metadata?.trending) {
      const entries = parseTrending(await fetchTrending(), query.metadata.trending);
      return { items: toTrendingItems(entries) };
    }

    const page = metadata?.page ?? 1;
    const title = query.title.trim().toLowerCase();
    const status = query.metadata?.status;

    const filtered = (await this.getDirectory()).filter((series) => {
      const titleMatch =
        title.length === 0 ||
        series.title.toLowerCase().includes(title) ||
        (series.alternative_names ?? "").toLowerCase().includes(title);
      return titleMatch && (!status || series.status === status);
    });

    const time = (value: string | null | undefined): number => {
      const parsed = new Date(value ?? "").getTime();
      return isNaN(parsed) ? 0 : parsed;
    };
    const sorted = filtered.sort((a, b) => {
      switch (sortingOption?.id) {
        case "updated":
          return time(b.update_chapter) - time(a.update_chapter);
        case "created":
          return time(b.created_at) - time(a.created_at);
        default:
          return (b.total_views ?? 0) - (a.total_views ?? 0);
      }
    });

    return {
      items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toSearchResultItem),
      metadata: page * PAGE_SIZE < sorted.length ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private getDirectory(): Promise<BrowseSeries[]> {
    this.directoryPromise ??= fetchDirectory()
      .then((payload) =>
        this.withRscTable(`${DOMAIN}/comics`, payload, (table) => parseDirectory(payload, table)),
      )
      .catch((error: unknown) => {
        this.directoryPromise = undefined;
        throw error;
      });
    return this.directoryPromise;
  }

  private getFeaturedItems(): Promise<DiscoverSectionItem[]> {
    this.featuredPromise ??= Promise.all([fetchFeatured().then(parseFeatured), this.getDirectory()])
      .then(([entries, directory]) => withFeaturedCovers(entries, directory))
      .then(toFeaturedItems)
      .catch((error: unknown) => {
        this.featuredPromise = undefined;
        throw error;
      });
    return this.featuredPromise;
  }

  // The site renames its RSC payload field keys; the table maps each logical name to the current
  // short key and is kept in state across sessions.
  private rscTable(): RscTable {
    return (Application.getState(RSC_KEYS_STATE) as RscTable | undefined) ?? {};
  }

  // Reads [payload] with the cached key table. When it does not fit — the site has renamed keys we
  // do not know — the table is rebuilt once from the site's bundle and the read is retried.
  private async withRscTable<T>(
    pageUrl: string,
    payload: string,
    parse: (table: RscTable) => T | undefined,
  ): Promise<T> {
    const cached = this.rscTable();
    const first = parse(cached);
    if (first !== undefined) return first;

    const refreshed = await this.refreshRscTable(pageUrl, payload, cached);
    const retry = refreshed === undefined ? undefined : parse(refreshed);
    if (retry === undefined) {
      throw new Error(
        `Temple Scan: could not read the page data for ${pageUrl} — the site layout may have changed`,
      );
    }
    return retry;
  }

  private refreshRscTable(
    pageUrl: string,
    payload: string,
    cached: RscTable,
  ): Promise<RscTable | undefined> {
    // One rebuild serves every read waiting on it within a burst.
    this.rscRefreshPromise ??= this.rebuildRscTable(pageUrl, payload, cached).finally(() => {
      this.rscRefreshPromise = undefined;
    });
    return this.rscRefreshPromise;
  }

  private async rebuildRscTable(
    pageUrl: string,
    payload: string,
    cached: RscTable,
  ): Promise<RscTable | undefined> {
    const chunks = extractChunkUrls(await fetchHtml(pageUrl));
    if (chunks.length === 0) return undefined;
    const keys = [...new Set([...observedKeys(payload), ...Object.values(cached)])];
    const cookies = this.cookieStorageInterceptor.cookiesForUrl(`${DOMAIN}/`);
    const decoded = await decodeRscTable(chunks, keys, cookies);
    if (!decoded || Object.keys(decoded).length === 0) return undefined;
    const merged = mergeRscTable(cached, decoded);
    Application.setState(merged, RSC_KEYS_STATE);
    return merged;
  }

  // New Series and Latest Updates share the homepage; dedupe the fetch
  // within a refresh burst while reloading fresh data on the next refresh.
  private getHomeSections(): Promise<HomeSections> {
    this.homePromise ??= fetchHomePage()
      .then((payload) => parseHomeSections(payload, this.rscTable()))
      .finally(() => {
        this.homePromise = undefined;
      });
    return this.homePromise;
  }
}

export const TempleScan = new TempleScanExtension();
