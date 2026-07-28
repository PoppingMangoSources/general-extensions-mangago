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
  type FilterTaxonomy,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  buildSearchPath,
  cookieStorage,
  fetchChapterListPage,
  fetchHtml,
  fetchListingPage,
  getRanobesUserAgent,
  replaceSessionCookies,
  RanobesInterceptor,
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
  toChapterUpdateItem,
  toCompletedItem,
  toFeaturedItem,
  toRankingItem,
  toSearchResult,
} from "./parsers";
import type RanobesConfig from "./pbconfig";

// Safety ceiling for the chapter-list crawl; matches the mature Aidoku source.
const MAX_CHAPTER_PAGES = 50;

export class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  // ranobes.net sits behind DDoS-Guard, which starts challenging when pages
  // arrive too fast — long chapter lists are dozens of sequential fetches. The
  // mature Aidoku source settled on 2 req/s for exactly this reason.
  mainRateLimiter = new BasicRateLimiter("ranobes-rate-limiter", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  requestManager = new RanobesInterceptor("ranobes-interceptor");

  private taxonomyPromise?: Promise<FilterTaxonomy>;

  // A long chapter list spans dozens of sequential fetches; repeating that
  // crawl every visit reads as automation, so one crawl is cached for a while.
  private chapterPagesCache?: {
    novelId: string;
    pages: ReturnType<typeof parseChapterPage>[];
    fetchedAt: number;
  };

  async initialise(): Promise<void> {
    cookieStorage.setCookie({
      name: "browser_check",
      value: "1",
      domain: "ranobes.net",
      path: "/",
    });
    cookieStorage.registerInterceptor();
    this.mainRateLimiter.registerInterceptor();
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
    this.chapterPagesCache = undefined;
    replaceSessionCookies(cookies);
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
        const $ = cheerio.load(await fetchListingPage("/updates/", page));
        return {
          items: parseListings($, "updates").flatMap((listing) => {
            const item = toChapterUpdateItem(listing);
            return item ? [item] : [];
          }),
          metadata: isLastListingPage($) ? undefined : { page: page + 1 },
        };
      }
      case SECTIONS.MOST_VIEWED:
        return this.getRankingItems("/ranking/", page, false);
      case SECTIONS.MOST_RATED:
        return this.getRankingItems("/ranking/rated/", page, true);
      case SECTIONS.ALL_TIME:
        return this.getRankingItems("/ranking/all_time/", page, false);
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

    const cached = this.chapterPagesCache;
    if (cached?.novelId === novelId && Date.now() - cached.fetchedAt < 10 * 60 * 1000) {
      return parseChapters(cached.pages, sourceManga);
    }

    const firstPage = parseChapterPage(cheerio.load(await fetchChapterListPage(novelId)));
    const pageCount = Math.min(MAX_CHAPTER_PAGES, Math.max(1, firstPage.pages_count ?? 1));
    const pages = [firstPage];
    for (let start = 2; start <= pageCount; start += 4) {
      const requests: Promise<ReturnType<typeof parseChapterPage>>[] = [];
      for (let page = start; page < Math.min(start + 4, pageCount + 1); page++) {
        requests.push(
          fetchChapterListPage(novelId, page).then((html) => parseChapterPage(cheerio.load(html))),
        );
      }
      pages.push(...(await Promise.all(requests)));
    }
    this.chapterPagesCache = { novelId, pages, fetchedAt: Date.now() };
    return parseChapters(pages, sourceManga);
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
}

export const Ranobes = new RanobesExtension();
