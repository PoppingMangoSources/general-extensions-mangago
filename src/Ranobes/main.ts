/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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
import * as cheerio from "cheerio";

import { RanobesAdvancedSearchForm } from "./forms/search";
import { RanobesSettingsForm } from "./forms/settings";
import {
  DISCOVER_SECTIONS,
  DOMAIN,
  PAGE_SIZE,
  SECTIONS,
  SORT_ORDERS,
  type FilterTaxonomy,
  type ChapterListSnapshot,
  type PageMetadata,
  type RanobesChapterPage,
  type SearchMetadata,
} from "./models";
import {
  buildSearchPath,
  cookieStorage,
  fetchChapterListPage,
  fetchHtml,
  fetchListingPage,
  getRanobesUserAgent,
  RanobesInterceptor,
  storeSessionCookies,
} from "./network";
import {
  extractNovelId,
  isLastListingPage,
  parseChapterDetails,
  parseChapterPage,
  parseChapters,
  parseFilterTaxonomy,
  parseListings,
  parseMangaDetails,
  parseHomepageRated,
  sameChapterPage,
  toChapterUpdateItem,
  toCompletedItem,
  toFeaturedItem,
  toRankingItem,
  toSearchResult,
} from "./parsers";
import type RanobesConfig from "./pbconfig";

class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  mainRateLimiter = new BasicRateLimiter("ranobes-rate-limiter", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  requestManager = new RanobesInterceptor("ranobes-interceptor");

  private taxonomyPromise?: Promise<FilterTaxonomy>;
  private interruptedChapterList?: ChapterListSnapshot;
  private completedChapterList?: ChapterListSnapshot;

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    cookieStorage.registerInterceptor();
    this.requestManager.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new RanobesSettingsForm(cookieStorage, await getRanobesUserAgent());
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.taxonomyPromise = undefined;
    storeSessionCookies(cookies);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    switch (section.id) {
      case SECTIONS.FEATURED:
        return {
          items: parseListings(cheerio.load(await fetchHtml(`${DOMAIN}/`)), "stories").map(
            toFeaturedItem,
          ),
        };
      case SECTIONS.LATEST: {
        const fromHomepage = metadata === undefined;
        const $ = cheerio.load(
          fromHomepage ? await fetchHtml(`${DOMAIN}/`) : await fetchListingPage("/updates/", page),
        );
        const collectedIds = new Set(metadata?.collectedIds ?? []);
        const listings = parseListings($, "updates").filter((listing) => {
          if (!listing.chapterId || collectedIds.has(listing.chapterId)) return false;
          collectedIds.add(listing.chapterId);
          return true;
        });
        return {
          items: listings.flatMap((listing) => {
            const item = toChapterUpdateItem(listing);
            return item ? [item] : [];
          }),
          metadata:
            fromHomepage || !isLastListingPage($)
              ? {
                  page: fromHomepage ? 1 : page + 1,
                  collectedIds: [...collectedIds],
                }
              : undefined,
        };
      }
      case SECTIONS.MOST_VIEWED:
        return this.getRankingItems("/ranking/", page, false);
      case SECTIONS.MOST_RATED:
        return {
          items: parseHomepageRated(cheerio.load(await fetchHtml(`${DOMAIN}/`))).map(
            (listing, index) => toRankingItem(listing, index + 1, true),
          ),
        };
      case SECTIONS.COMPLETED: {
        const $ = cheerio.load(await fetchListingPage("/tags/status-trs/Completed/", page));
        return {
          items: parseListings($, "stories").map(toCompletedItem),
          metadata: isLastListingPage($) ? undefined : { page: page + 1 },
        };
      }
      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new RanobesAdvancedSearchForm(
      query,
      await (this.taxonomyPromise ??= this.getFilterTaxonomy().catch((error: unknown) => {
        this.taxonomyPromise = undefined;
        throw error;
      })),
    );
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const path = buildSearchPath(query.title, query.metadata, sortingOption) ?? "/novels/";
    const $ = cheerio.load(await fetchListingPage(path, page));
    return {
      items: parseListings($, "stories").map(toSearchResult),
      metadata: isLastListingPage($) ? undefined : { page: page + 1 },
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_ORDERS.map(({ id, label }) => ({ id, label }));
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(cheerio.load(await fetchHtml(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const novelId = extractNovelId(sourceManga.mangaId);
    const firstPage = await this.fetchChapterPage(novelId, 1);
    const pageCount =
      firstPage.pages_count ??
      (firstPage.count_all && firstPage.limit
        ? Math.ceil(firstPage.count_all / firstPage.limit)
        : 1);
    const completed = this.completedChapterList;
    if (
      completed?.novelId === novelId &&
      completed.expiresAt > Date.now() &&
      completed.pages.length === pageCount &&
      sameChapterPage(firstPage, completed.pages[0])
    ) {
      return parseChapters([firstPage, ...completed.pages.slice(1)], sourceManga);
    }
    if (completed?.novelId === novelId || (completed && completed.expiresAt <= Date.now())) {
      this.completedChapterList = undefined;
    }

    let pages = [firstPage];
    const interrupted = this.interruptedChapterList;
    if (interrupted && interrupted.expiresAt <= Date.now()) {
      this.interruptedChapterList = undefined;
    } else if (interrupted?.novelId === novelId) {
      const savedPages = interrupted.pages;
      if (savedPages.length <= pageCount && sameChapterPage(firstPage, savedPages[0])) {
        const boundary = await this.fetchChapterPage(novelId, savedPages.length);
        if (sameChapterPage(boundary, savedPages[savedPages.length - 1])) {
          pages = [firstPage, ...savedPages.slice(1, -1), boundary];
        }
      }
      if (this.interruptedChapterList === interrupted) this.interruptedChapterList = undefined;
    }
    try {
      for (let page = pages.length + 1; page <= pageCount; page++) {
        pages.push(await this.fetchChapterPage(novelId, page));
      }
    } catch (error) {
      if (pages.length > 1) {
        this.interruptedChapterList = { novelId, pages, expiresAt: Date.now() + 10 * 60_000 };
      }
      throw error;
    }
    const chapters = parseChapters(pages, sourceManga);
    if (firstPage.count_all && chapters.length < firstPage.count_all) {
      throw new Error(
        `Ranobes: loaded ${chapters.length} of ${firstPage.count_all} chapters for ${sourceManga.mangaId}`,
      );
    }
    if (pages.length > 1) {
      this.completedChapterList = { novelId, pages, expiresAt: Date.now() + 2 * 60 * 60_000 };
    }
    return chapters;
  }

  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    const [first] = updateManager.getQueuedItems();
    if (!first) return;
    try {
      await fetchChapterListPage(extractNovelId(first.mangaId), 1);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(cheerio.load(await fetchHtml(chapter.chapterId)), chapter);
  }

  private async getRankingItems(
    path: string,
    page: number,
    useRating: boolean,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = cheerio.load(await fetchListingPage(path, page));
    return {
      items: parseListings($, "rankings").map((listing, index) =>
        toRankingItem(listing, index + (page - 1) * PAGE_SIZE + 1, useRating),
      ),
      metadata: isLastListingPage($) ? undefined : { page: page + 1 },
    };
  }

  private async getFilterTaxonomy(): Promise<FilterTaxonomy> {
    return parseFilterTaxonomy(
      await fetchHtml(`${DOMAIN}/engine/mods/dle_filter/ajax.php?action=options`),
    );
  }

  private async fetchChapterPage(novelId: string, page: number): Promise<RanobesChapterPage> {
    const chapterPage = parseChapterPage(cheerio.load(await fetchChapterListPage(novelId, page)));
    if (chapterPage.cstart !== undefined && chapterPage.cstart !== page) {
      throw new Error(`Ranobes returned chapter page ${chapterPage.cstart} instead of ${page}`);
    }
    return chapterPage;
  }
}

export const Ranobes = new RanobesExtension();
