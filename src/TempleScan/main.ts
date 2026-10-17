/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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
  type UpdateManager,
} from "@paperback/types";

import { getShowPaidChapters, TempleScanAdvancedSearchForm, TempleScanSettingsForm } from "./forms";
import {
  DISCOVER_SECTIONS,
  DOMAIN,
  PAGE_SIZE,
  PAID_CHAPTER_SUFFIX,
  SECTIONS,
  SORTING_OPTIONS,
  type BrowseSeries,
  type PageMetadata,
  type SearchMetadata,
  type SiteChapter,
  type SitePageKind,
} from "./models";
import {
  fetchFeatured,
  fetchHtml,
  fetchTrending,
  readSitePage,
  TempleScanInterceptor,
} from "./network";
import {
  parseChapters,
  parseFeatured,
  parseMangaDetails,
  parseTrending,
  sortSeries,
  toCarouselItem,
  toFeaturedItems,
  toSearchResultItem,
  toTrendingItems,
  toTrendingSections,
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

  // The comics page holds the whole catalog; it is read once per session.
  private directoryPromise?: Promise<BrowseSeries[]>;
  private featuredPromise?: Promise<DiscoverSectionItem[]>;

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
    // The site's own verification keeps its pass in its own cookie, alongside Cloudflare's.
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  async getSettingsForm(): Promise<Form> {
    return new TempleScanSettingsForm();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const [html, directory] = await Promise.all([
      fetchHtml(`${DOMAIN}/comic/${mangaId}`),
      this.getDirectory(),
    ]);
    return parseMangaDetails(
      html,
      mangaId,
      directory.find((series) => series.series_slug === mangaId),
    );
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = await this.readSitePage<SiteChapter[]>(
      `${DOMAIN}/comic/${sourceManga.mangaId}`,
      "chapters",
    );
    if (!chapters) throw new Error(`Temple Scan: no chapters found for ${sourceManga.mangaId}`);
    return parseChapters(chapters, sourceManga, getShowPaidChapters());
  }

  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    const [first] = updateManager.getQueuedItems();
    if (!first) return;
    try {
      await fetchHtml(`${DOMAIN}/comic/${first.mangaId}`);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapter.chapterId.endsWith(PAID_CHAPTER_SUFFIX)) {
      throw new Error("This chapter is paid. Unlock it on the website before reading.");
    }
    const pages = await this.readSitePage<string[]>(
      `${DOMAIN}/comic/${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
      "pages",
    );
    if (!pages?.length) {
      throw new Error("Temple Scan: no pages found. The chapter may be locked on the website.");
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED:
        return { items: await this.getFeaturedItems() };
      case SECTIONS.NEW_SERIES:
        return this.getDirectorySection("created", metadata);
      case SECTIONS.LATEST:
        return this.getDirectorySection("updated", metadata);
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

    const sorted = sortSeries(filtered, sortingOption?.id);

    return {
      items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toSearchResultItem),
      metadata: page * PAGE_SIZE < sorted.length ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private readSitePage<T>(url: string, kind: SitePageKind): Promise<T | undefined> {
    return readSitePage<T>(url, kind, this.cookieStorageInterceptor.cookiesForUrl(url));
  }

  private getDirectory(): Promise<BrowseSeries[]> {
    this.directoryPromise ??= this.readSitePage<BrowseSeries[]>(`${DOMAIN}/comics`, "catalog")
      .then((directory) => {
        if (!directory) throw new Error("Temple Scan: the comics page listed no series");
        return directory;
      })
      .catch((error: unknown) => {
        this.directoryPromise = undefined;
        throw error;
      });
    return this.directoryPromise;
  }

  private async getDirectorySection(
    sort: string,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const sorted = sortSeries(await this.getDirectory(), sort);
    return {
      items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toCarouselItem),
      metadata: page * PAGE_SIZE < sorted.length ? { page: page + 1 } : undefined,
    };
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
}

export const TempleScan = new TempleScanExtension();
