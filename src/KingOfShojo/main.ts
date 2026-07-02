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
import type { CheerioAPI } from "cheerio";

import { KingOfShojoSearchForm } from "./forms/search";
import { getBaseUrlOverride, getShowAdultContent, KingOfShojoSettingsForm } from "./forms/settings";
import {
  ADULT_GENRE_NAMES,
  CARD_SELECTOR,
  DEFAULT_DOMAIN,
  MANGA_DIR,
  NEXT_PAGE_SELECTOR,
  ORDER_OPTIONS,
  POPULAR_RANGE_OPTIONS,
  type OptionItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchCheerio, KingOfShojoInterceptor } from "./network";
import {
  hasNextPage,
  parseCards,
  parseChapterPages,
  parseChapters,
  parseGenreFilter,
  parseLatestUpdate,
  parseMangaDetails,
  parsePopularSeries,
  parsePopularToday,
  parseRecommendation,
} from "./parsers";
import type KingOfShojoConfig from "./pbconfig";

const SORTING_OPTIONS: SortingOption[] = ORDER_OPTIONS.map((option) => ({
  id: option.id,
  label: option.value,
}));

const MAX_SEARCH_PAGES = 5;
const HOMEPAGE_TTL = 60 * 1000;
const GENRES_TTL = 60 * 60 * 1000;
// The featured hero fetches per-title details (author/description), so cap the
// count and cache the result longer to keep discover snappy.
const FEATURED_LIMIT = 10;
const FEATURED_TTL = 5 * 60 * 1000;

function buildInfoItems(rating?: string, status?: string): FeaturedCarouselItem["infoItems"] {
  const items: { symbol: string; text: string }[] = [];
  if (rating) items.push({ symbol: "star.fill", text: rating });
  if (status && status !== "Unknown") items.push({ symbol: "book.closed", text: status });
  if (items.length === 0) return undefined;
  return items.length === 1 ? [items[0]] : [items[0], items[1]];
}

export class KingOfShojoExtension implements ExtensionImpl<typeof KingOfShojoConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  mainInterceptor = new KingOfShojoInterceptor("main", () => this.baseUrl);

  private homepageCache: { $: CheerioAPI; timestamp: number } | null = null;
  private genresCache: { options: OptionItem[]; timestamp: number } | null = null;
  private featuredCache: {
    items: DiscoverSectionItem[];
    timestamp: number;
    adult: boolean;
  } | null = null;

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
    return new KingOfShojoSettingsForm(DEFAULT_DOMAIN);
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
  // Discover — scraped from the homepage widgets
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "popular_today", title: "Popular Today", type: DiscoverSectionType.featured },
      { id: "latest_update", title: "Latest Update", type: DiscoverSectionType.chapterUpdates },
      { id: "recommendation", title: "Recommendation", type: DiscoverSectionType.simpleCarousel },
      // Weekly/Monthly/All is exposed as selectable chips via the genres type.
      { id: "popular_series", title: "Popular Series", type: DiscoverSectionType.genres },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rating = this.contentRating;

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

    // Popular Series — Weekly/Monthly/All range chips; each opens the ranked
    // list for that range via getSearchResults.
    if (section.id === "popular_series") {
      const items: DiscoverSectionItem[] = POPULAR_RANGE_OPTIONS.map((range) => ({
        type: "genresCarouselItem",
        name: range.value,
        searchQuery: {
          title: "",
          metadata: { popularRange: range.id } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    // Popular Today — the featured hero, enriched with author + description.
    if (section.id === "popular_today") {
      return { items: await this.buildFeaturedItems(), metadata: undefined };
    }

    const $ = await this.getHomepage();
    let items: DiscoverSectionItem[] = [];

    switch (section.id) {
      case "recommendation":
        items = parseRecommendation($, this.baseUrl).map((card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          subtitle: card.subtitle,
          contentRating: rating,
        }));
        break;
      case "latest_update":
        items = parseLatestUpdate($, this.baseUrl)
          .filter((card) => card.chapterId)
          .map((card) => ({
            type: "chapterUpdatesCarouselItem",
            mangaId: card.mangaId,
            chapterId: card.chapterId!,
            title: card.title,
            imageUrl: card.imageUrl,
            subtitle: card.chapterName,
            publishDate: card.publishDate,
            contentRating: rating,
          }));
        break;
    }

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new KingOfShojoSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title || "").trim();
    const meta = query.metadata;

    // Popular Series range chip tapped — return that ranking from the homepage.
    if (meta?.popularRange) {
      const $ = await this.getHomepage();
      const items: SearchResultItem[] = parsePopularSeries(
        $,
        this.baseUrl,
        meta.popularRange,
        getShowAdultContent(),
      ).map((card) => ({
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle: card.subtitle,
        contentRating: card.isAdult ? ContentRating.ADULT : this.contentRating,
      }));
      return { items, metadata: undefined };
    }

    // Let users paste a manga link into search to open it directly.
    const pasted = await this.resolveUrlQuery(title);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const order = sortingOption?.id || meta?.orderBy?.[0] || "";

    const builder = new URL(this.baseUrl)
      .addPathComponent(MANGA_DIR)
      .setQueryItem("title", title)
      .setQueryItem("page", page.toString());
    if (order) builder.setQueryItem("order", order);
    if (meta?.author) builder.setQueryItem("author", meta.author);
    if (meta?.year) builder.setQueryItem("yearx", meta.year);
    if (meta?.status?.[0]) builder.setQueryItem("status", meta.status[0]);
    if (meta?.type?.[0]) builder.setQueryItem("type", meta.type[0]);

    const genreStates: Record<string, "included" | "excluded"> = { ...meta?.genres };
    // Hide adult genres unless the reader opted in — but never override a genre
    // the reader explicitly chose to include or exclude.
    if (!getShowAdultContent()) {
      for (const slug of await this.adultGenreSlugs()) {
        if (!(slug in genreStates)) genreStates[slug] = "excluded";
      }
    }
    const genreValues = Object.entries(genreStates).map(([slug, state]) =>
      state === "excluded" ? `-${slug}` : slug,
    );
    if (genreValues.length > 0) builder.setQueryItem("genre[]", genreValues);

    const $ = await fetchCheerio({ url: builder.toString(), method: "GET" });
    const items: SearchResultItem[] = parseCards($, this.baseUrl, CARD_SELECTOR).map((card) => ({
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle: card.subtitle,
      contentRating: this.contentRating,
    }));

    const nextPage = hasNextPage($, NEXT_PAGE_SELECTOR) && page < MAX_SEARCH_PAGES;
    return { items, metadata: nextPage ? { page: page + 1 } : undefined };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    if (!/^https?:\/\//i.test(query)) return undefined;
    const match = query.match(new RegExp(`/${MANGA_DIR}/([^/?#]+)`, "i"));
    if (!match) return undefined;

    try {
      const manga = await this.getMangaDetails(decodeURIComponent(match[1]));
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
    return new URL(this.baseUrl).addPathComponent(MANGA_DIR).addPathComponent(mangaId).toString();
  }

  private async getHomepage(): Promise<CheerioAPI> {
    if (this.homepageCache && Date.now() - this.homepageCache.timestamp < HOMEPAGE_TTL) {
      return this.homepageCache.$;
    }
    const $ = await fetchCheerio({ url: `${this.baseUrl}/`, method: "GET" });
    this.homepageCache = { $, timestamp: Date.now() };
    return $;
  }

  // Enriches the "Popular Today" hero cards with author + description + status
  // by fetching each title's details (capped and cached).
  private async buildFeaturedItems(): Promise<DiscoverSectionItem[]> {
    const showAdult = getShowAdultContent();
    if (
      this.featuredCache &&
      this.featuredCache.adult === showAdult &&
      Date.now() - this.featuredCache.timestamp < FEATURED_TTL
    ) {
      return this.featuredCache.items;
    }

    const $ = await this.getHomepage();
    const cards = parsePopularToday($, this.baseUrl).slice(0, FEATURED_LIMIT);
    const fallbackRating = this.contentRating;

    const built = await Promise.all(
      cards.map(async (card): Promise<DiscoverSectionItem | null> => {
        let supertitle: string | undefined;
        let summary: string | undefined;
        let status: string | undefined;
        let itemRating: ContentRating = fallbackRating;
        try {
          const manga = await this.getMangaDetails(card.mangaId);
          supertitle = manga.mangaInfo.author;
          summary = manga.mangaInfo.synopsis || undefined;
          status = manga.mangaInfo.status;
          itemRating = manga.mangaInfo.contentRating;
        } catch {
          // Keep the basic card if the details request fails.
        }
        // Drop adult titles from the hero unless the reader opted in.
        if (!showAdult && itemRating === ContentRating.ADULT) return null;
        return {
          type: "featuredCarouselItem",
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          supertitle,
          summary,
          infoItems: buildInfoItems(card.rating, status),
          contentRating: itemRating,
        };
      }),
    );
    const items = built.filter((item): item is DiscoverSectionItem => item !== null);

    this.featuredCache = { items, timestamp: Date.now(), adult: showAdult };
    return items;
  }

  // The genre slugs whose display name marks them as adult, resolved from the
  // live browse-page filter list so the real slugs are used.
  private async adultGenreSlugs(): Promise<string[]> {
    const genres = await this.getGenres();
    return genres
      .filter((genre) => ADULT_GENRE_NAMES.has(genre.value.trim().toLowerCase()))
      .map((genre) => genre.id);
  }

  private async getGenres(): Promise<OptionItem[]> {
    if (this.genresCache && Date.now() - this.genresCache.timestamp < GENRES_TTL) {
      return this.genresCache.options;
    }
    try {
      const url = new URL(this.baseUrl).addPathComponent(MANGA_DIR).toString();
      const $ = await fetchCheerio({ url, method: "GET" });
      const options = parseGenreFilter($);
      if (options.length > 0) this.genresCache = { options, timestamp: Date.now() };
      return options;
    } catch {
      return this.genresCache?.options ?? [];
    }
  }
}

export const KingOfShojo = new KingOfShojoExtension();
