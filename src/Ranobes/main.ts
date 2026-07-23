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

import { RanobesAdvancedSearchForm } from "./forms";
import {
  DISCOVER_SECTIONS,
  PAGE_SIZE,
  SECTION_ALL_TIME,
  SECTION_FEATURED,
  SECTION_LATEST,
  SECTION_MOST_RATED,
  SECTION_MOST_VIEWED,
  SORTING_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchChapterList,
  fetchFilter,
  fetchHomepage,
  fetchHtml,
  fetchListing,
  fetchSearch,
  RanobesInterceptor,
} from "./network";
import {
  extractNovelId,
  hasNextPage,
  parseChapterDetails,
  parseChapterPage,
  parseChapters,
  parseFeatured,
  parseLatestUpdates,
  parseMangaDetails,
  parseRankings,
  parseSearchResults,
  toFeaturedItem,
  toRankingItem,
} from "./parsers";
import type RanobesConfig from "./pbconfig";

export class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  mainInterceptor = new RanobesInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

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
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    switch (section.id) {
      case SECTION_FEATURED:
        return { items: parseFeatured(await fetchHomepage()).map(toFeaturedItem) };
      case SECTION_LATEST: {
        const html = await fetchListing("/updates/", page);
        return {
          items: parseLatestUpdates(html),
          metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
        };
      }
      case SECTION_MOST_VIEWED:
        return this.getRankingItems("/ranking/", page, false);
      case SECTION_MOST_RATED:
        return this.getRankingItems("/ranking/rated/", page, true);
      case SECTION_ALL_TIME:
        return this.getRankingItems("/ranking/all_time/", page, false);
      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new RanobesAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = query.title.trim();
    const filterPath = buildFilterPath(query.metadata, sortingOption);
    const html = title
      ? await fetchSearch(title, page)
      : filterPath
        ? await fetchFilter(filterPath, page)
        : await fetchListing(sortingOption?.id === "rating" ? "/ranking/rated/" : "/novels/", page);
    return {
      items: parseSearchResults(html),
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchHtml(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const novelId = extractNovelId(sourceManga.mangaId);
    const firstPage = parseChapterPage(await fetchChapterList(novelId));
    const pageCount = Math.max(1, firstPage.pages_count ?? 1);
    const laterPages = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        fetchChapterList(novelId, index + 2).then(parseChapterPage),
      ),
    );
    return parseChapters([firstPage, ...laterPages], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(await fetchHtml(chapter.chapterId), chapter);
  }

  private async getRankingItems(
    path: string,
    page: number,
    useRating: boolean,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchListing(path, page);
    return {
      items: parseRankings(html).map((card, index) =>
        toRankingItem(card, index + (page - 1) * PAGE_SIZE, useRating),
      ),
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }
}

const buildFilterPath = (
  metadata: SearchMetadata | undefined,
  sortingOption: SortingOption | undefined,
): string | undefined => {
  if (!metadata && !sortingOption) return undefined;
  const segments: string[] = [];
  const genres = metadata?.genres ?? {};
  const includedGenres = Object.keys(genres).filter((genre) => genres[genre] === "included");
  const excludedGenres = Object.keys(genres).filter((genre) => genres[genre] === "excluded");
  if (includedGenres.length > 0)
    segments.push(`genre=${encodeURIComponent(includedGenres.join(","))}`);
  if (excludedGenres.length > 0)
    segments.push(`not-genre=${encodeURIComponent(excludedGenres.join(","))}`);
  if (metadata?.language) segments.push(`languages=${encodeURIComponent(metadata.language)}`);
  if (metadata?.status) segments.push(`status-end=${encodeURIComponent(metadata.status)}`);
  if (metadata?.author) segments.push(`author=${encodeURIComponent(metadata.author)}`);
  if (metadata?.translator) segments.push(`translater=${encodeURIComponent(metadata.translator)}`);
  const sort = sortingOption?.id === "date-asc" ? "date" : sortingOption?.id;
  if (sort) {
    segments.push(`sort=${encodeURIComponent(sort)}`);
    if (sortingOption?.id === "date-asc") segments.push("order=asc");
  }
  return segments.length > 0 ? `/f/${segments.join("/")}/` : undefined;
};

export const Ranobes = new RanobesExtension();
