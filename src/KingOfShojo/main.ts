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
import { getBaseUrlOverride, getImageMode, KingOfShojoSettingsForm } from "./forms/settings";
import {
  DEFAULT_DOMAIN,
  FEATURED_LIMIT,
  MANGA_DIR,
  NEXT_PAGE_SELECTOR,
  POPULAR_RANGE_OPTIONS,
  SECTIONS,
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
  parseWidgetCards,
  proxyImage,
} from "./parsers";
import type KingOfShojoConfig from "./pbconfig";

class KingOfShojoExtension implements ExtensionImpl<typeof KingOfShojoConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  mainInterceptor = new KingOfShojoInterceptor("main", () => this.baseUrl);

  private homepageCache: { promise: Promise<CheerioAPI>; baseUrl: string } | null = null;
  private genresCache: { promise: Promise<OptionItem[]>; baseUrl: string } | null = null;
  private featuredCache: {
    items: DiscoverSectionItem[];
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
    this.genresCache = null;
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
      { id: SECTIONS.POPULAR_TODAY, title: "Popular Today", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.RECOMMENDATION,
        title: "Recommendation",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.POPULAR_SERIES, title: "Popular Series", type: DiscoverSectionType.genres },
      {
        id: SECTIONS.LATEST_UPDATE,
        title: "Latest Update",
        type: DiscoverSectionType.chapterUpdates,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rating = this.contentRating;

    if (section.id === SECTIONS.GENRES) {
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

    if (section.id === SECTIONS.POPULAR_SERIES) {
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

    if (section.id === SECTIONS.POPULAR_TODAY) {
      return { items: await this.buildFeaturedItems(), metadata: undefined };
    }

    const $ = await this.getHomepage();
    let items: DiscoverSectionItem[] = [];

    switch (section.id) {
      case SECTIONS.RECOMMENDATION:
        items = parseWidgetCards($, this.baseUrl, "Recommendation").map((card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          subtitle: card.subtitle,
          contentRating: rating,
        }));
        break;
      case SECTIONS.LATEST_UPDATE:
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
      const items: SearchResultItem[] = parsePopularSeries($, this.baseUrl, meta.popularRange).map(
        (card) => ({
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          subtitle: card.subtitle,
          contentRating: card.isAdult ? ContentRating.ADULT : this.contentRating,
        }),
      );
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
    const genreValues = Object.entries(genreStates).map(([slug, state]) =>
      state === "excluded" ? `-${slug}` : slug,
    );
    if (genreValues.length > 0) builder.setQueryItem("genre[]", genreValues);

    const $ = await fetchCheerio({ url: builder.toString(), method: "GET" });
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
    const url = this.ensureTrailingSlash(
      new URL(this.baseUrl).addPathComponent(chapter.chapterId).toString(),
    );
    const $ = await fetchCheerio({ url, method: "GET" });
    const mode = getImageMode();
    const pages = parseChapterPages($, this.baseUrl).map((page) => proxyImage(page, mode));
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  private mangaUrl(mangaId: string): string {
    return this.ensureTrailingSlash(
      new URL(this.baseUrl).addPathComponent(MANGA_DIR).addPathComponent(mangaId).toString(),
    );
  }

  private ensureTrailingSlash(url: string): string {
    return url.endsWith("/") ? url : `${url}/`;
  }

  private async getHomepage(): Promise<CheerioAPI> {
    const baseUrl = this.baseUrl;
    if (this.homepageCache?.baseUrl !== baseUrl) this.homepageCache = null;
    const record = (this.homepageCache ??= {
      baseUrl,
      promise: fetchCheerio({ url: `${baseUrl}/`, method: "GET" }).catch((error: unknown) => {
        if (this.homepageCache === record) this.homepageCache = null;
        throw error;
      }),
    });
    return record.promise;
  }

  private async buildFeaturedItems(): Promise<DiscoverSectionItem[]> {
    const baseUrl = this.baseUrl;
    if (this.featuredCache && this.featuredCache.baseUrl === baseUrl) {
      return this.featuredCache.items;
    }

    const $ = await this.getHomepage();
    const cards = parseWidgetCards($, this.baseUrl, "Popular Today").slice(0, FEATURED_LIMIT);

    const built = await Promise.all(
      cards.map(async (card): Promise<DiscoverSectionItem | null> => {
        let supertitle: string | undefined;
        let summary: string | undefined;
        let status: string | undefined;
        let itemRating: ContentRating = this.contentRating;
        try {
          const manga = await this.getMangaDetails(card.mangaId);
          supertitle = manga.mangaInfo.author;
          summary = manga.mangaInfo.synopsis || undefined;
          status = manga.mangaInfo.status;
          itemRating = manga.mangaInfo.contentRating;
        } catch (error) {
          if (error instanceof CloudflareError) throw error;
        }
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
      this.featuredCache = { items, baseUrl };
    }
    return items;
  }

  private async getGenres(): Promise<OptionItem[]> {
    const baseUrl = this.baseUrl;
    if (this.genresCache?.baseUrl !== baseUrl) this.genresCache = null;
    const record = (this.genresCache ??= {
      baseUrl,
      promise: fetchCheerio({
        url: new URL(baseUrl).addPathComponent(`${MANGA_DIR}/`).toString(),
        method: "GET",
      }).then(
        ($) => {
          const options = parseGenreFilter($);
          if (options.length === 0 && this.genresCache === record) this.genresCache = null;
          return options;
        },
        (error: unknown) => {
          if (this.genresCache === record) this.genresCache = null;
          throw error;
        },
      ),
    });
    return record.promise;
  }
}

export const KingOfShojo = new KingOfShojoExtension();
