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
  fetchHtml,
  getUserAgent,
  isChallengePage,
  passChallenge,
  readSitePage,
  TempleScanInterceptor,
} from "./network";
import {
  parseChapters,
  parseMangaDetails,
  sortSeries,
  toCarouselItem,
  parseLatestUpdates,
  toFeaturedItems,
  toSearchResultItem,
  toTrendingItems,
  toTrendingSections,
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
  // One pass of the site's check serves every page waiting on it.
  private challengePromise?: Promise<boolean>;
  private homeHtmlPromise?: Promise<string>;
  private homePromise?: Promise<Partial<Record<SitePageKind, unknown>>>;

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
    this.saveCookies(cookies);
  }

  // The site's own verification keeps its pass in its own cookie, alongside Cloudflare's.
  private saveCookies(cookies: Cookie[]): void {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  // A page served as the site's check is passed in the background and fetched again; the check is
  // only handed to the user when it does not pass on its own.
  private async fetchPage(url: string): Promise<string> {
    const html = await fetchHtml(url);
    if (!isChallengePage(html)) return html;
    if (
      await (this.challengePromise ??= this.passChallenge(html, url).finally(() => {
        this.challengePromise = undefined;
      }))
    ) {
      const retried = await fetchHtml(url);
      if (!isChallengePage(retried)) return retried;
    }
    throw new CloudflareError({
      url,
      method: "GET",
      headers: { "user-agent": await getUserAgent() },
    });
  }

  private async passChallenge(html: string, url: string): Promise<boolean> {
    let cookies: Cookie[] | undefined;
    try {
      cookies = await passChallenge(html, url, this.cookieStorageInterceptor.cookiesForUrl(url));
    } catch {
      // A WebView that cannot run the check leaves it to the user.
      return false;
    }
    if (!cookies) return false;
    this.saveCookies(cookies);
    return true;
  }

  async getSettingsForm(): Promise<Form> {
    return new TempleScanSettingsForm();
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const [html, directory] = await Promise.all([
      this.fetchPage(`${DOMAIN}/comic/${mangaId}`),
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
      await this.fetchPage(`${DOMAIN}/comic/${first.mangaId}`);
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
      true,
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
        return { items: toFeaturedItems((await this.getHome()).featured) };
      case SECTIONS.TRENDING:
        return { items: toTrendingSections() };
      case SECTIONS.NEW_SERIES:
        return this.getNewSeriesSection(metadata);
      case SECTIONS.LATEST:
        return { items: parseLatestUpdates(await this.getHomeHtml()) };
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
      return { items: toTrendingItems((await this.getHome()).trending, query.metadata.trending) };
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

  private async readSitePage<T>(
    url: string,
    kind: SitePageKind,
    settles = false,
  ): Promise<T | undefined> {
    const html = await this.fetchPage(url);
    const data = await readSitePage(
      html,
      url,
      [kind],
      this.cookieStorageInterceptor.cookiesForUrl(url),
      settles,
    );
    return data[kind] as T | undefined;
  }

  // Featured, Trending and Latest Updates share the homepage; one fetch serves them within a refresh.
  private getHomeHtml(): Promise<string> {
    this.homeHtmlPromise ??= this.fetchPage(`${DOMAIN}/`).finally(() => {
      this.homeHtmlPromise = undefined;
    });
    return this.homeHtmlPromise;
  }

  private getHome(): Promise<Partial<Record<SitePageKind, unknown>>> {
    this.homePromise ??= this.getHomeHtml()
      .then((html) =>
        readSitePage(
          html,
          `${DOMAIN}/`,
          ["featured", "trending"],
          this.cookieStorageInterceptor.cookiesForUrl(`${DOMAIN}/`),
          true,
        ),
      )
      .finally(() => {
        this.homePromise = undefined;
      });
    return this.homePromise;
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

  private async getNewSeriesSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const sorted = sortSeries(await this.getDirectory(), "created");
    return {
      items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toCarouselItem),
      metadata: page * PAGE_SIZE < sorted.length ? { page: page + 1 } : undefined,
    };
  }
}

export const TempleScan = new TempleScanExtension();
