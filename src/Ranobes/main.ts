/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
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
import * as cheerio from "cheerio";

import { RanobesAdvancedSearchForm } from "./forms/search";
import { RanobesSettingsForm } from "./forms/settings";
import {
  DISCOVER_SECTIONS,
  DOMAIN,
  PAGE_SIZE,
  SECTIONS,
  SORT_ORDERS,
  STATE_KEYS,
  type ChapterCrawlCheckpoint,
  type FilterTaxonomy,
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
  toChapterUpdateItem,
  toCompletedItem,
  toFeaturedItem,
  toRankingItem,
  toSearchResult,
} from "./parsers";
import type RanobesConfig from "./pbconfig";

const isChapterCrawlCheckpoint = (value: unknown): value is ChapterCrawlCheckpoint => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const checkpoint = value as Partial<ChapterCrawlCheckpoint>;
  return (
    typeof checkpoint.novelId === "string" &&
    !!checkpoint.pages &&
    typeof checkpoint.pages === "object" &&
    !Array.isArray(checkpoint.pages) &&
    (checkpoint.pageCount === undefined || typeof checkpoint.pageCount === "number") &&
    (checkpoint.completedAt === undefined || typeof checkpoint.completedAt === "number")
  );
};

const orderedChapterPages = (
  checkpoint: ChapterCrawlCheckpoint,
  pageCount: number,
): RanobesChapterPage[] => {
  const pages = Array.from(
    { length: pageCount },
    (_, index) => checkpoint.pages[String(index + 1)],
  ).filter((page): page is RanobesChapterPage => page !== undefined);
  if (pages.length !== pageCount) {
    throw new Error(`Ranobes: loaded ${pages.length} of ${pageCount} chapter-list pages`);
  }
  return pages;
};

export const resumeChapterPageCrawl = async (
  checkpoint: ChapterCrawlCheckpoint,
  pageCount: number,
  fetchPage: (page: number) => Promise<RanobesChapterPage>,
): Promise<RanobesChapterPage[]> => {
  const missingPages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (page) => checkpoint.pages[String(page)] === undefined,
  );
  const batchSize = 3;

  for (let offset = 0; offset < missingPages.length; offset += batchSize) {
    const results = await Promise.allSettled(
      missingPages.slice(offset, offset + batchSize).map(async (page) => {
        checkpoint.pages[String(page)] = await fetchPage(page);
      }),
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) throw failure.reason;
  }

  return orderedChapterPages(checkpoint, pageCount);
};

class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  mainRateLimiter = new BasicRateLimiter("ranobes-rate-limiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });

  requestManager = new RanobesInterceptor("ranobes-interceptor");

  private taxonomyPromise?: Promise<FilterTaxonomy>;

  // Successful pages survive a challenge so the resumed crawl skips them.
  private chapterCrawl?: ChapterCrawlCheckpoint;

  async initialise(): Promise<void> {
    this.requestManager.registerInterceptor();
    this.mainRateLimiter.registerInterceptor();
    cookieStorage.registerInterceptor();
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
      await (this.taxonomyPromise ??= this.getFilterTaxonomy()),
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
    const current = this.chapterCrawl;
    if (
      current?.novelId === novelId &&
      current.completedAt !== undefined &&
      current.pageCount !== undefined &&
      Date.now() - current.completedAt < 10 * 60 * 1000
    ) {
      return parseChapters(orderedChapterPages(current, current.pageCount), sourceManga);
    }

    const saved = Application.getState(STATE_KEYS.CHAPTER_CRAWL);
    const checkpoint =
      current?.novelId === novelId && current.completedAt === undefined
        ? current
        : isChapterCrawlCheckpoint(saved) &&
            saved.novelId === novelId &&
            saved.completedAt === undefined
          ? saved
          : { novelId, pages: {} };
    if (
      !isChapterCrawlCheckpoint(saved) ||
      saved.novelId !== novelId ||
      saved.completedAt !== undefined
    ) {
      Application.setState(undefined, STATE_KEYS.CHAPTER_CRAWL);
    }
    this.chapterCrawl = checkpoint;

    let firstPage = checkpoint.pages["1"];
    if (!firstPage) {
      firstPage = await this.fetchChapterPage(novelId, 1);
      checkpoint.pages["1"] = firstPage;
    }
    const pageCount = Math.max(
      1,
      firstPage.pages_count ??
        (firstPage.count_all && firstPage.limit
          ? Math.ceil(firstPage.count_all / firstPage.limit)
          : 1),
    );
    checkpoint.pageCount = pageCount;

    let pages: RanobesChapterPage[];
    try {
      pages = await resumeChapterPageCrawl(checkpoint, pageCount, (page) =>
        this.fetchChapterPage(novelId, page),
      );
    } catch (error) {
      Application.setState(checkpoint, STATE_KEYS.CHAPTER_CRAWL);
      throw error;
    }
    const chapters = parseChapters(pages, sourceManga);
    if (firstPage.count_all && chapters.length < firstPage.count_all) {
      throw new Error(
        `Ranobes: loaded ${chapters.length} of ${firstPage.count_all} chapters for ${sourceManga.mangaId}`,
      );
    }
    checkpoint.completedAt = Date.now();
    Application.setState(undefined, STATE_KEYS.CHAPTER_CRAWL);
    return chapters;
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
    return parseFilterTaxonomy(cheerio.load(await fetchListingPage("/novels/")));
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
