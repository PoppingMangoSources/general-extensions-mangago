/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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
  BROWSE_SORT,
  DEFAULT_DOMAIN,
  FEATURED_LIMIT,
  GENRES_KEY,
  NEXT_PAGE_SELECTOR,
  SEARCH_PATH,
  SORTING_OPTIONS,
  type OptionItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchCheerio, VyMangaInterceptor } from "./network";
import {
  extractMangaId,
  getStoredGenres,
  parseCards,
  parseChapterPages,
  parseChapters,
  parseGenres,
  parseMangaDetails,
} from "./parsers";
import type VyMangaConfig from "./pbconfig";

export class VyMangaExtension implements ExtensionImpl<typeof VyMangaConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  mainInterceptor = new VyMangaInterceptor("main", () => this.baseUrl);

  private featuredItems?: DiscoverSectionItem[];
  private genresPromise?: Promise<OptionItem[]>;

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
    this.featuredItems = undefined;
    this.genresPromise = undefined;
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
      .setQueryItem("author_po", meta.authorType?.[0] ?? "0");

    if (meta.author) builder.setQueryItem("author", meta.author);
    if (meta.status?.[0]) builder.setQueryItem("completed", meta.status[0]);
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
    const host = query.match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase();
    const baseHost = this.baseUrl
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .toLowerCase();
    if (!host || host !== baseHost) return undefined;
    const mangaId = extractMangaId(query);
    if (!mangaId) return undefined;

    try {
      const manga = await this.getMangaDetails(mangaId);
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
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await fetchCheerio({ url, method: "GET" });
    return parseMangaDetails($, this.baseUrl, mangaId, url, this.contentRating);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await fetchCheerio({ url: this.mangaUrl(sourceManga.mangaId), method: "GET" });
    return parseChapters($, this.baseUrl, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (!/^https?:\/\//i.test(chapter.chapterId)) {
      throw new Error("Refresh the chapter list to reload chapters.");
    }
    const url = `${chapter.chapterId}${chapter.chapterId.includes("?") ? "&" : "?"}view=0`;
    const $ = await fetchCheerio({ url, method: "GET" });
    const pages = parseChapterPages($, this.baseUrl);
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  private mangaUrl(mangaId: string): string {
    return `${this.baseUrl}/manga/${mangaId}`;
  }

  private async buildFeaturedItems(): Promise<DiscoverSectionItem[]> {
    if (this.featuredItems) return this.featuredItems;

    const rating = this.contentRating;
    const $ = await fetchCheerio({ url: this.browseUrl("viewed", 1), method: "GET" });
    const cards = parseCards($, this.baseUrl).slice(0, FEATURED_LIMIT);

    // Built from the "most viewed" browse listing alone — no per-card detail
    // fetch. Author and synopsis are not present on the listing cards.
    const items = cards.map(
      (card): DiscoverSectionItem => ({
        type: "featuredCarouselItem",
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        contentRating: rating,
      }),
    );

    this.featuredItems = items;
    return items;
  }

  private async getGenres(): Promise<OptionItem[]> {
    if (this.genresPromise) return this.genresPromise;
    const request = this.loadGenres().catch((error: unknown) => {
      if (this.genresPromise === request) this.genresPromise = undefined;
      throw error;
    });
    this.genresPromise = request;
    return this.genresPromise;
  }

  private async loadGenres(): Promise<OptionItem[]> {
    const stored = getStoredGenres();
    if (stored.length > 0) return stored;
    const $ = await fetchCheerio({ url: this.baseUrl, method: "GET" });
    const genres = parseGenres($);
    if (genres.length > 0) Application.setState(JSON.stringify(genres), GENRES_KEY);
    return genres;
  }
}

export const VyManga = new VyMangaExtension();
