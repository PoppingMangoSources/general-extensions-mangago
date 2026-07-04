/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
  CookieStorageInterceptor,
  DiscoverSectionType,
  URL,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type FeaturedCarouselItem,
  type Form,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { VyMangaSearchForm } from "./forms/search";
import { getBaseUrlOverride, VyMangaSettingsForm } from "./forms/settings";
import {
  DEFAULT_DOMAIN,
  NEXT_PAGE_SELECTOR,
  SEARCH_PATH,
  SORT_OPTIONS,
  type OptionItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchCheerio, VyMangaInterceptor } from "./network";
import {
  parseCards,
  parseChapterPages,
  parseChapters,
  parseGenreFilter,
  parseMangaDetails,
  parsePath,
} from "./parsers";
import type VyMangaConfig from "./pbconfig";

const SORTING_OPTIONS: SortingOption[] = SORT_OPTIONS.map((option) => ({
  id: option.id,
  label: option.value,
}));

// Discover browse rows map to a `sort` field on the `/search` endpoint.
const BROWSE_SORT: Record<string, string> = {
  popular: "viewed",
  latest_updates: "updated_at",
  top_rated: "scored",
  newest: "created_at",
};

const GENRES_TTL = 60 * 60 * 1000;
// The featured hero fetches per-title details (author/description), so cap the
// count and cache the result to keep discover snappy.
const FEATURED_LIMIT = 8;
const FEATURED_TTL = 5 * 60 * 1000;

export class VyMangaExtension implements ExtensionImpl<typeof VyMangaConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  mainInterceptor = new VyMangaInterceptor("main", () => this.baseUrl);

  private genresCache: { options: OptionItem[]; timestamp: number } | null = null;
  private featuredCache: { items: DiscoverSectionItem[]; timestamp: number } | null = null;

  get baseUrl(): string {
    return getBaseUrlOverride() ?? DEFAULT_DOMAIN;
  }

  get contentRating(): ContentRating {
    return ContentRating.MATURE;
  }

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new VyMangaSettingsForm(DEFAULT_DOMAIN);
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

  // ----------------------------------------------------------------
  // Discover
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
      { id: "latest_updates", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: "top_rated", title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
      { id: "newest", title: "Newest", type: DiscoverSectionType.simpleCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const genres = await this.getGenres();
      const items: DiscoverSectionItem[] = genres
        .filter((genre) => genre.id)
        .map((genre) => ({
          type: "genresCarouselItem",
          name: genre.value,
          searchQuery: {
            title: "",
            metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
          },
          metadata: undefined,
        }));
      return { items, metadata: undefined };
    }

    if (section.id === "popular") {
      return { items: await this.buildFeaturedItems(), metadata: undefined };
    }

    const sort = BROWSE_SORT[section.id] ?? "updated_at";
    const page = metadata?.page ?? 1;
    const $ = await fetchCheerio({ url: this.browseUrl(sort, page), method: "GET" });
    const items: DiscoverSectionItem[] = parseCards($, this.baseUrl).map((card) => ({
      type: "simpleCarouselItem",
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle: card.subtitle,
      contentRating: this.contentRating,
    }));

    const nextPage = $(NEXT_PAGE_SELECTOR).length > 0;
    return { items, metadata: nextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new VyMangaSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title || "").trim();
    const meta = query.metadata ?? {};

    // Let readers paste a manga link into search to open it directly.
    const pasted = await this.resolveUrlQuery(title);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const url = this.buildSearchUrl(title, meta, page, sortingOption?.id);

    const $ = await fetchCheerio({ url, method: "GET" });
    const items: SearchResultItem[] = parseCards($, this.baseUrl).map((card) => ({
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle: card.subtitle,
      contentRating: this.contentRating,
    }));

    const nextPage = $(NEXT_PAGE_SELECTOR).length > 0;
    return { items, metadata: nextPage ? { page: page + 1 } : undefined };
  }

  private buildSearchUrl(
    title: string,
    meta: SearchMetadata,
    page: number,
    sortOverride?: string,
  ): string {
    const builder = new URL(this.baseUrl)
      .addPathComponent(SEARCH_PATH)
      .setQueryItem("q", title)
      .setQueryItem("page", page.toString())
      .setQueryItem("search_po", meta.searchType?.[0] ?? "0")
      .setQueryItem("author_po", meta.authorType?.[0] ?? "0")
      .setQueryItem("author", meta.author ?? "")
      .setQueryItem("completed", meta.status?.[0] ?? "");

    if (meta.searchDescription) builder.setQueryItem("check_search_desc", "1");

    const sort = sortOverride || meta.sort?.[0];
    if (sort) {
      builder.setQueryItem("sort", sort);
      builder.setQueryItem("sort_type", meta.order?.[0] ?? "desc");
    }

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [id, state] of Object.entries(meta.genres ?? {})) {
      if (state === "included") included.push(id);
      else if (state === "excluded") excluded.push(id);
    }
    if (included.length > 0) builder.setQueryItem("genre[]", included);
    if (excluded.length > 0) builder.setQueryItem("exclude_genre[]", excluded);

    return builder.toString();
  }

  private browseUrl(sort: string, page: number): string {
    return new URL(this.baseUrl)
      .addPathComponent(SEARCH_PATH)
      .setQueryItem("sort", sort)
      .setQueryItem("sort_type", "desc")
      .setQueryItem("page", page.toString())
      .toString();
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    if (!/^https?:\/\//i.test(query)) return undefined;
    if (!/\/manga(?:-detail)?\//i.test(query)) return undefined;

    try {
      const manga = await this.getMangaDetails(parsePath(query));
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
    } catch {
      return undefined;
    }
  }

  // ----------------------------------------------------------------
  // Details, chapters, pages
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await fetchCheerio({ url, method: "GET" });
    return parseMangaDetails($, this.baseUrl, mangaId, url, this.contentRating);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await fetchCheerio({ url: this.mangaUrl(sourceManga.mangaId), method: "GET" });
    return parseChapters($, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URL(this.baseUrl).addPathComponent(chapter.chapterId).toString();
    const $ = await fetchCheerio({ url, method: "GET" });
    const pages = parseChapterPages($, this.baseUrl);
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    return new URL(this.baseUrl).addPathComponent(mangaId).toString();
  }

  // Enriches the Popular hero with author + description + rating by fetching
  // each title's details (capped and cached).
  private async buildFeaturedItems(): Promise<DiscoverSectionItem[]> {
    if (this.featuredCache && Date.now() - this.featuredCache.timestamp < FEATURED_TTL) {
      return this.featuredCache.items;
    }

    const rating = this.contentRating;
    const $ = await fetchCheerio({ url: this.browseUrl("viewed", 1), method: "GET" });
    const cards = parseCards($, this.baseUrl).slice(0, FEATURED_LIMIT);

    const items = await Promise.all(
      cards.map(async (card): Promise<DiscoverSectionItem> => {
        let supertitle: string | undefined;
        let summary: string | undefined;
        let status: string | undefined;
        try {
          const manga = await this.getMangaDetails(card.mangaId);
          supertitle = manga.mangaInfo.author;
          summary = manga.mangaInfo.synopsis || undefined;
          status = manga.mangaInfo.status;
        } catch {
          // Keep the basic card if the details request fails.
        }
        const infoItems: FeaturedCarouselItem["infoItems"] =
          status && status !== "Unknown" ? [{ symbol: "book.closed", text: status }] : undefined;
        return {
          type: "featuredCarouselItem",
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          supertitle,
          summary,
          infoItems,
          contentRating: rating,
        };
      }),
    );

    this.featuredCache = { items, timestamp: Date.now() };
    return items;
  }

  private async getGenres(): Promise<OptionItem[]> {
    if (this.genresCache && Date.now() - this.genresCache.timestamp < GENRES_TTL) {
      return this.genresCache.options;
    }
    try {
      const url = new URL(this.baseUrl).addPathComponent(SEARCH_PATH).toString();
      const $ = await fetchCheerio({ url, method: "GET" });
      const options = parseGenreFilter($);
      if (options.length > 0) this.genresCache = { options, timestamp: Date.now() };
      return options;
    } catch {
      return this.genresCache?.options ?? [];
    }
  }
}

export const VyManga = new VyMangaExtension();
