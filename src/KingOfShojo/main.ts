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
  type Response,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import { KingOfShojoAdvancedSearchForm } from "./forms/search";
import {
  getBaseUrlOverride,
  getImageMode,
  getShowAdultContent,
  KingOfShojoSettingsForm,
} from "./forms/settings";
import {
  ADULT_GENRE_NAMES,
  CARD_SELECTOR,
  DEFAULT_DOMAIN,
  FEATURED_LIMIT,
  MANGA_DIR,
  NEXT_PAGE_SELECTOR,
  POPULAR_RANGE_OPTIONS,
  SORTING_OPTIONS,
  type OptionItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchCheerio, KingOfShojoInterceptor } from "./network";
import {
  buildInfoItems,
  parseCards,
  parseChapterPages,
  parseChapters,
  parseGenreFilter,
  parseLatestUpdate,
  parseMangaDetails,
  parseMangaId,
  parsePopularSeries,
  parsePopularToday,
  parseRecommendation,
  proxyImage,
} from "./parsers";
import type KingOfShojoConfig from "./pbconfig";

export class KingOfShojoExtension implements ExtensionImpl<typeof KingOfShojoConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  mainInterceptor = new KingOfShojoInterceptor("main", () => this.baseUrl);

  private homepageCache: { $: CheerioAPI; baseUrl: string } | null = null;
  private homepagePromise: { promise: Promise<CheerioAPI>; baseUrl: string } | null = null;
  private genresCache: { options: OptionItem[]; baseUrl: string } | null = null;
  private genresPromise: { promise: Promise<OptionItem[]>; baseUrl: string } | null = null;
  private featuredCache: {
    items: DiscoverSectionItem[];
    adult: boolean;
    baseUrl: string;
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

    Application.setRedirectHandler(
      Application.Selector(this as KingOfShojoExtension, "handleRedirect"),
    );
  }

  async handleRedirect(request: Request, _response: Response): Promise<Request> {
    return this.mainInterceptor.interceptRequest(request);
  }

  async getSettingsForm(): Promise<Form> {
    return new KingOfShojoSettingsForm(DEFAULT_DOMAIN);
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.homepageCache = null;
    this.homepagePromise = null;
    this.genresCache = null;
    this.genresPromise = null;
    this.featuredCache = null;
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
      { id: "popular_today", title: "Popular Today", type: DiscoverSectionType.featured },
      { id: "latest_update", title: "Latest Update", type: DiscoverSectionType.chapterUpdates },
      { id: "recommendation", title: "Recommendation", type: DiscoverSectionType.simpleCarousel },
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

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new KingOfShojoAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title || "").trim();
    const meta = query.metadata;

    if (meta?.popularRange && !title) {
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

    const pasted = await this.resolveUrlQuery(title);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const order = sortingOption?.id || "";

    const builder = new URL(this.baseUrl)
      .addPathComponent(`${MANGA_DIR}/`)
      .setQueryItem("title", title)
      .setQueryItem("page", page.toString());
    if (order) builder.setQueryItem("order", order);
    if (meta?.author) builder.setQueryItem("author", meta.author);
    if (meta?.year) builder.setQueryItem("yearx", meta.year);
    if (meta?.status?.[0]) builder.setQueryItem("status", meta.status[0]);
    if (meta?.type?.[0]) builder.setQueryItem("type", meta.type[0]);

    const genreStates: Record<string, "included" | "excluded"> = { ...meta?.genres };
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

    const nextPage = $(NEXT_PAGE_SELECTOR).length > 0;
    return { items, metadata: nextPage ? { page: page + 1 } : undefined };
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
    if (!new RegExp(`/${MANGA_DIR}/[^/?#]+`, "i").test(query)) return undefined;

    try {
      const manga = await this.getMangaDetails(parseMangaId(query));
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
    return parseChapters($, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const base = new URL(this.baseUrl).addPathComponent(chapter.chapterId).toString();
    const url = base.endsWith("/") ? base : `${base}/`;
    const $ = await fetchCheerio({ url, method: "GET" });
    const mode = getImageMode();
    const pages = parseChapterPages($, this.baseUrl).map((page) => proxyImage(page, mode));
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  private mangaUrl(mangaId: string): string {
    const url = new URL(this.baseUrl)
      .addPathComponent(MANGA_DIR)
      .addPathComponent(mangaId)
      .toString();
    return url.endsWith("/") ? url : `${url}/`;
  }

  private async getHomepage(): Promise<CheerioAPI> {
    const baseUrl = this.baseUrl;
    if (this.homepageCache && this.homepageCache.baseUrl === baseUrl) {
      return this.homepageCache.$;
    }
    if (this.homepagePromise && this.homepagePromise.baseUrl === baseUrl) {
      return this.homepagePromise.promise;
    }
    const promise = fetchCheerio({ url: `${baseUrl}/`, method: "GET" })
      .then(($) => {
        this.homepageCache = { $, baseUrl };
        return $;
      })
      .finally(() => {
        this.homepagePromise = null;
      });
    this.homepagePromise = { promise, baseUrl };
    return promise;
  }

  private async buildFeaturedItems(): Promise<DiscoverSectionItem[]> {
    const showAdult = getShowAdultContent();
    const baseUrl = this.baseUrl;
    if (
      this.featuredCache &&
      this.featuredCache.adult === showAdult &&
      this.featuredCache.baseUrl === baseUrl
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
        } catch (error) {
          if (error instanceof CloudflareError) throw error;
        }
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

    if (items.length > 0) {
      this.featuredCache = { items, adult: showAdult, baseUrl };
    }
    return items;
  }

  private async adultGenreSlugs(): Promise<string[]> {
    const genres = await this.getGenres();
    return genres
      .filter((genre) => ADULT_GENRE_NAMES.has(genre.value.trim().toLowerCase()))
      .map((genre) => genre.id);
  }

  private async getGenres(): Promise<OptionItem[]> {
    const baseUrl = this.baseUrl;
    if (this.genresCache && this.genresCache.baseUrl === baseUrl) {
      return this.genresCache.options;
    }
    if (this.genresPromise?.baseUrl === baseUrl) return this.genresPromise.promise;

    const request = {
      baseUrl,
      promise: fetchCheerio({
        url: new URL(baseUrl).addPathComponent(`${MANGA_DIR}/`).toString(),
        method: "GET",
      }).then(($) => {
        const options = parseGenreFilter($);
        if (options.length > 0) this.genresCache = { options, baseUrl };
        return options;
      }),
    };
    request.promise = request.promise.finally(() => {
      if (this.genresPromise === request) this.genresPromise = null;
    });
    this.genresPromise = request;
    return request.promise;
  }
}

export const KingOfShojo = new KingOfShojoExtension();
