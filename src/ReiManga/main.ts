/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
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

import { getBaseUrl, ReiMangaAdvancedSearchForm, ReiMangaSettingsForm } from "./forms";
import {
  GENRES,
  PERIODS,
  SECTIONS,
  SORTING_OPTIONS,
  type ApiManga,
  type ApiMangaDetails,
  type ApiMangaList,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchFlight, fetchJson, ReiMangaInterceptor } from "./network";
import {
  numericIdFrom,
  parseChapterPages,
  parseChapters,
  toFeaturedItem,
  toLatestItem,
  toSearchResultItem,
  toSimpleItem,
  toSourceManga,
} from "./parsers";
import type ReiMangaConfig from "./pbconfig";

const PAGE_SIZE = 24;

class ReiMangaExtension implements ExtensionImpl<typeof ReiMangaConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new ReiMangaInterceptor("main");

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new ReiMangaSettingsForm();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      this.cookieStorageInterceptor.setCookie(cookie);
    }
    Application.invalidateDiscoverSections();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
      { id: SECTIONS.MOST_READ, title: "Most Read", type: DiscoverSectionType.genres },
      { id: SECTIONS.NEW, title: "New Manga", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED: {
        const list = await fetchJson<ApiManga[]>(
          `${getBaseUrl()}/api/manga/trending?limit=10&full=1`,
        );
        return { items: list.map(toFeaturedItem), metadata: undefined };
      }
      case SECTIONS.MOST_READ:
        return { items: this.periodChips(), metadata: undefined };
      case SECTIONS.NEW: {
        const list = await fetchJson<ApiMangaList>(`${getBaseUrl()}/api/manga/new?limit=12`);
        return {
          items: (list.data ?? []).map((manga) => toSimpleItem(manga, "chapter")),
          metadata: undefined,
        };
      }
      case SECTIONS.LATEST: {
        const list = await fetchJson<ApiMangaList>(
          `${getBaseUrl()}/api/manga/latest-updates?limit=18`,
        );
        return { items: (list.data ?? []).map(toLatestItem), metadata: undefined };
      }
      case SECTIONS.TOP_RATED: {
        const list = await fetchJson<ApiMangaList>(
          `${getBaseUrl()}/api/manga?page=1&limit=${PAGE_SIZE}&sort=scored&order=desc`,
        );
        return {
          items: (list.data ?? []).map((manga, index) => toSimpleItem(manga, "rating", index + 1)),
          metadata: undefined,
        };
      }
      case SECTIONS.GENRES:
        return { items: this.genreChips(), metadata: undefined };
      default:
        return { items: [], metadata: undefined };
    }
  }

  // Chips run through search so each ranking stays pageable rather than being
  // capped at whatever one carousel request returns.
  private periodChips(): DiscoverSectionItem[] {
    return PERIODS.map((period) => ({
      type: "genresCarouselItem",
      name: period.title,
      searchQuery: {
        title: "",
        metadata: { period: period.id } satisfies SearchMetadata,
      },
      metadata: undefined,
    }));
  }

  private genreChips(): DiscoverSectionItem[] {
    return GENRES.map((genre) => ({
      type: "genresCarouselItem",
      name: genre.title,
      searchQuery: {
        title: "",
        metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
      },
      metadata: undefined,
    }));
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new ReiMangaAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const period = query.metadata?.period;

    // The Most Read ranking is a fixed-size list with no paging of its own.
    if (period) {
      const list = await fetchJson<ApiManga[]>(
        `${getBaseUrl()}/api/manga/most-read?limit=30&period=${encodeURIComponent(period)}`,
      );
      return { items: list.map(toSearchResultItem), metadata: undefined };
    }

    const list = await fetchJson<ApiMangaList>(this.buildSearchUrl(query, sortingOption, page));
    const current = list.pagination?.currentPage ?? page;
    const total = list.pagination?.totalPages ?? current;

    return {
      items: (list.data ?? []).map(toSearchResultItem),
      metadata: current < total ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(
    query: SearchQuery<SearchMetadata>,
    sortingOption: SortingOption | undefined,
    page: number,
  ): string {
    const meta = query.metadata;
    const params: string[] = [`page=${page}`, `limit=${PAGE_SIZE}`];

    const term = (query.title ?? "").trim();
    if (term) params.push(`search=${encodeURIComponent(term)}`);

    if (sortingOption?.id) {
      params.push(`sort=${encodeURIComponent(sortingOption.id)}`);
      // Title is the one order the site reads ascending.
      params.push(`order=${sortingOption.id === "title" ? "asc" : "desc"}`);
    }

    const status = meta?.status?.[0];
    if (status) params.push(`status=${encodeURIComponent(status)}`);

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [id, state] of Object.entries(meta?.genres ?? {})) {
      if (state === "included") included.push(id);
      else excluded.push(id);
    }
    if (included.length > 0) params.push(`genre=${encodeURIComponent(included.join(","))}`);
    if (excluded.length > 0) {
      params.push(`excludeGenres=${encodeURIComponent(excluded.join(","))}`);
    }

    return `${getBaseUrl()}/api/manga?${params.join("&")}`;
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const host = getBaseUrl().replace(/^https?:\/\//, "");
    const pattern = new RegExp(
      `^https?://(?:www\\.)?(?:reimanga\\.com|${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})/manga/([^/?#]+)`,
      "i",
    );
    const slug = pattern.exec(query.trim())?.[1];
    if (!slug) return undefined;

    const manga = await this.getMangaDetails(decodeURIComponent(slug));
    return {
      items: [
        {
          mangaId: manga.mangaId,
          title: manga.mangaInfo.primaryTitle,
          imageUrl: manga.mangaInfo.thumbnailUrl,
          contentRating: manga.mangaInfo.contentRating,
        },
      ],
      metadata: undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const numericId = numericIdFrom(mangaId);
    if (!numericId) throw new Error(`Cannot derive a series id from ${mangaId}`);

    const details = await fetchJson<ApiMangaDetails>(`${getBaseUrl()}/api/manga/${numericId}`);
    if (!details.manga) throw new Error(`No details found for ${mangaId}`);
    return toSourceManga(details.manga, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const body = await fetchFlight(`${getBaseUrl()}/manga/${sourceManga.mangaId}`);
    return parseChapters(body, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const body = await fetchFlight(
      `${getBaseUrl()}/manga/${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
    );
    return parseChapterPages(body, chapter);
  }
}

export const ReiManga = new ReiMangaExtension();
