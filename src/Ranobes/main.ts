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
  type RanobesListing,
  type SearchMetadata,
} from "./models";
import {
  buildSearchPath,
  fetchChapterListPage,
  fetchChapterSearch,
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
  parseContentRating,
  parseFilterTaxonomy,
  parseListings,
  parseMangaDetails,
} from "./parsers";
import type RanobesConfig from "./pbconfig";

const formatCount = (value: number): string => value.toLocaleString("en-US");

const toFeaturedItem = (listing: RanobesListing): DiscoverSectionItem => ({
  type: "featuredCarouselItem",
  mangaId: listing.mangaId,
  title: listing.title,
  imageUrl: listing.imageUrl,
  summary: listing.description,
  infoItems:
    listing.rating !== undefined && listing.views !== undefined
      ? [
          {
            symbol: "star.fill",
            text: `${listing.rating.toFixed(1)}${
              listing.ratingCount ? ` (${listing.ratingCount})` : ""
            }`,
          },
          { symbol: "eye.fill", text: formatCount(listing.views) },
        ]
      : listing.rating !== undefined
        ? [
            {
              symbol: "star.fill",
              text: `${listing.rating.toFixed(1)}${
                listing.ratingCount ? ` (${listing.ratingCount})` : ""
              }`,
            },
          ]
        : listing.views !== undefined
          ? [{ symbol: "eye.fill", text: formatCount(listing.views) }]
          : undefined,
  contentRating: parseContentRating(listing.genres ?? []),
});

const toChapterUpdateItem = (listing: RanobesListing): DiscoverSectionItem | undefined => {
  if (!listing.chapterId) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: listing.mangaId,
    chapterId: listing.chapterId,
    title: listing.title,
    imageUrl: listing.imageUrl,
    subtitle: listing.chapterTitle || undefined,
    publishDate: listing.publishDate,
  };
};

const toRankingItem = (
  listing: RanobesListing,
  rank: number,
  useRating: boolean,
): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: listing.mangaId,
  title: listing.title,
  imageUrl: listing.imageUrl,
  subtitle: useRating
    ? `#${rank} • ★ ${listing.rating?.toFixed(1) ?? "—"}${
        listing.ratingCount ? ` (${listing.ratingCount})` : ""
      }`
    : `#${rank} • ${formatCount(listing.views ?? 0)} views`,
  contentRating: parseContentRating(listing.genres ?? []),
});

const toSearchResult = (listing: RanobesListing): SearchResultItem => ({
  mangaId: listing.mangaId,
  title: listing.title,
  imageUrl: listing.imageUrl,
  subtitle: listing.rating !== undefined ? `★ ${listing.rating.toFixed(1)}` : undefined,
  contentRating: parseContentRating(listing.genres ?? []),
});

export class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  requestManager = new RanobesInterceptor("main");

  cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

  private taxonomyPromise?: Promise<FilterTaxonomy>;

  async initialise(): Promise<void> {
    this.cookieStorage.setCookie({
      name: "browser_check",
      value: "1",
      domain: "ranobes.net",
      path: "/",
    });
    this.cookieStorage.registerInterceptor();
    this.mainRateLimiter.registerInterceptor();
    this.requestManager.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.taxonomyPromise = undefined;
    for (const cookie of cookies) {
      if (cookie.domain.includes("ranobes.net")) this.cookieStorage.setCookie(cookie);
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
    const firstPage = parseChapterPage(cheerio.load(await fetchChapterListPage(novelId)));
    const pageCount = Math.max(1, firstPage.pages_count ?? 1);
    if (pageCount === 1) return parseChapters([firstPage], sourceManga);

    try {
      const searchPage = await fetchChapterSearch(novelId);
      if (
        firstPage.count_all !== undefined &&
        searchPage.chapters?.length === firstPage.count_all
      ) {
        return parseChapters([searchPage], sourceManga);
      }
    } catch {
      // The search endpoint is an optional fast path; regular chapter pages remain authoritative.
    }

    const remainingPages = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        fetchChapterListPage(novelId, index + 2).then((html) =>
          parseChapterPage(cheerio.load(html)),
        ),
      ),
    );
    return parseChapters([firstPage, ...remainingPages], sourceManga);
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
    return parseFilterTaxonomy(cheerio.load(await fetchListingPage("/tags/events/")));
  }
}

export const Ranobes = new RanobesExtension();
