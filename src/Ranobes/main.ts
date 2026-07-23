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
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { RanobesAdvancedSearchForm } from "./forms/search";
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
  canonicalUrl,
  fetchChapterListPage,
  fetchHtml,
  fetchListingPage,
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

export class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 4,
    bufferInterval: 1,
    ignoreImages: true,
  });

  requestManager = new RanobesInterceptor("main");

  cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private taxonomyPromise?: Promise<FilterTaxonomy>;

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.cookieStorage.registerInterceptor();
    this.requestManager.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.taxonomyPromise = undefined;
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorage.setCookie(cookie);
      }
    }
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
    return parseMangaDetails(cheerio.load(await fetchHtml(canonicalUrl(mangaId))), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const novelId = extractNovelId(sourceManga.mangaId);
    const firstPage = parseChapterPage(cheerio.load(await fetchChapterListPage(novelId)));
    const pageCount = Math.max(1, firstPage.pages_count ?? 1);

    const remainingPages =
      pageCount > 1
        ? await Promise.all(
            Array.from({ length: pageCount - 1 }, (_, index) =>
              fetchChapterListPage(novelId, index + 2).then((html) =>
                parseChapterPage(cheerio.load(html)),
              ),
            ),
          )
        : [];
    return parseChapters([firstPage, ...remainingPages], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(
      cheerio.load(await fetchHtml(canonicalUrl(chapter.chapterId))),
      chapter,
    );
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
