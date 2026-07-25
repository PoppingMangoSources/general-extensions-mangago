/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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

import { OMangaAdvancedSearchForm } from "./forms/search";
import { getDomain, OMangaSettingsForm } from "./forms/settings";
import {
  AGE_RATING_OPTIONS,
  type CatalogItem,
  type CatalogQuery,
  FEATURED_HERO_LIMIT,
  GENRE_OPTIONS,
  type PageMetadata,
  resolveOptionValues,
  SECTIONS,
  SORT_OPTIONS,
  TOP_SERIES_CHIPS,
  TYPE_OPTIONS,
  type SearchMetadata,
} from "./models";
import {
  buildSeriesNavigationHeaders,
  fetchCatalog,
  fetchFlightPayload,
  fetchHtmlPage,
  fetchPagePayload,
  OMangaInterceptor,
} from "./network";
import {
  getContentRatingForGenres,
  parseCatalogItems,
  parseChapterDetails,
  parseChapters,
  parseHomeLinkSection,
  parseHomeSection,
  parseHomeTopSeries,
  parseHomeUpdates,
  parseMangaDetails,
  toHomeCarouselItem,
  toLinkCardProminentItem,
  toLinkCardSimpleItem,
  toProminentCarouselItem,
  toSearchResultItem,
  toSimpleCarouselItem,
} from "./parsers";
import type OMangaConfig from "./pbconfig";

export class OMangaExtension implements ExtensionImpl<typeof OMangaConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 10,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new OMangaInterceptor("main");

  private homepageRequest: { domain: string; page: Promise<string> } | undefined;
  private seriesPageRequest: { key: string; page: Promise<string> } | undefined;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
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
    this.homepageRequest = undefined;
    this.seriesPageRequest = undefined;
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.UPDATES,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
      },
      { id: SECTIONS.TOP_SERIES, title: "Top Series", type: DiscoverSectionType.genres },
      { id: SECTIONS.NEW_SEASON, title: "New Season", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.MOST_LIKED, title: "Most Liked", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.BEST_ONGOING,
        title: "Best Ongoings",
        type: DiscoverSectionType.prominentCarousel,
      },
      { id: SECTIONS.TREND, title: "In the Trend", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.POPULAR_TODAY,
        title: "Popular Today",
        type: DiscoverSectionType.prominentCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.TOP_SERIES) {
      const items: DiscoverSectionItem[] = TOP_SERIES_CHIPS.map((chip) => ({
        type: "genresCarouselItem",
        name: chip.title,
        searchQuery: {
          title: "",
          metadata: {
            topSeriesCountry: chip.country,
            types: [chip.type],
            sort: "rating",
          } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === SECTIONS.GENRES) {
      const items: DiscoverSectionItem[] = GENRE_OPTIONS.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.value,
        searchQuery: {
          title: "",
          metadata: { genres: [genre.id] } satisfies SearchMetadata,
        },
        contentRating: getContentRatingForGenres([genre.value]),
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === SECTIONS.UPDATES) {
      return { items: parseHomeUpdates(await this.getHomepage(true)), metadata: undefined };
    }

    if (section.id === SECTIONS.POPULAR) {
      let items = parseHomeSection(await this.getHomepage(), "Popular This Week");
      if (items.length === 0) {
        items = (await this.fetchCatalogPage({ sort: "by_views", order: "desc" }, undefined)).items;
      }
      return { items: this.buildFeaturedItems(items), metadata: undefined };
    }

    if (section.id === SECTIONS.MOST_LIKED) {
      const homeItems = parseHomeSection(await this.getHomepage(), "Most liked");
      if (homeItems.length > 0) {
        return {
          items: homeItems.filter((item) => item.poster.length > 0).map(toHomeCarouselItem),
          metadata: undefined,
        };
      }
    }

    if (section.id === SECTIONS.NEW_SEASON) {
      const cards = parseHomeLinkSection(await this.getHomepage(), "New Season", '"hl-col-items"');
      if (cards.length > 0) {
        return {
          items: cards.map(toLinkCardSimpleItem),
          metadata: undefined,
        };
      }
    }

    if (section.id === SECTIONS.TREND) {
      const cards = parseHomeLinkSection(
        await this.getHomepage(),
        "In the Trend",
        '"hl-col-items"',
      );
      if (cards.length > 0) {
        return {
          items: cards.map(toLinkCardSimpleItem),
          metadata: undefined,
        };
      }
    }

    if (section.id === SECTIONS.POPULAR_TODAY) {
      const cards = parseHomeLinkSection(
        await this.getHomepage(),
        "Popular Today",
        '"hl-col-items"',
      );
      if (cards.length > 0) {
        return {
          items: cards.map(toLinkCardProminentItem),
          metadata: undefined,
        };
      }
    }

    if (section.id === SECTIONS.BEST_ONGOING) {
      const cards = parseHomeLinkSection(await this.getHomepage(), "Best Ongoings", '"grid gap-2');
      if (cards.length > 0) {
        return {
          items: cards.map(toLinkCardProminentItem),
          metadata: undefined,
        };
      }
    }

    const query: CatalogQuery =
      section.id === SECTIONS.BEST_ONGOING
        ? { sort: "rating", order: "desc", status: "Ongoing" }
        : section.id === SECTIONS.POPULAR_TODAY
          ? { sort: "votes", order: "desc" }
          : {
              sort:
                section.id === SECTIONS.NEW_SEASON
                  ? "by_date"
                  : section.id === SECTIONS.TREND
                    ? "by_views"
                    : section.id === SECTIONS.MOST_LIKED
                      ? "votes"
                      : "real_views",
              order: "desc",
            };

    const { items, nextMetadata } = await this.fetchCatalogPage(query, metadata);
    const toCarouselItem =
      section.id === SECTIONS.BEST_ONGOING || section.id === SECTIONS.POPULAR_TODAY
        ? toProminentCarouselItem
        : toSimpleCarouselItem;

    return {
      items: items
        .map(toCarouselItem)
        .filter((item) => "imageUrl" in item && item.imageUrl.length > 0),
      metadata: nextMetadata,
    };
  }

  private buildFeaturedItems(items: CatalogItem[]): DiscoverSectionItem[] {
    return items
      .filter((item) => item.poster.length > 0)
      .slice(0, FEATURED_HERO_LIMIT)
      .map(
        (item): DiscoverSectionItem => ({
          type: "featuredCarouselItem",
          mangaId: item.slug,
          title: item.title,
          imageUrl: item.poster,
          supertitle: item.type ?? "",
          infoItems: item.year ? [{ symbol: "calendar", text: String(item.year) }] : undefined,
          contentRating: getContentRatingForGenres(item.genres),
          metadata: undefined,
        }),
      );
  }

  private getHomepage(refresh = false): Promise<string> {
    const domain = getDomain();
    if (!refresh && this.homepageRequest?.domain === domain) {
      return this.homepageRequest.page;
    }

    const request = { domain, page: fetchPagePayload(`${domain}/`, '"updates":[') };
    request.page = request.page.catch((error: unknown) => {
      if (this.homepageRequest === request) this.homepageRequest = undefined;
      throw error;
    });
    this.homepageRequest = request;
    return request.page;
  }

  async getSettingsForm(): Promise<Form> {
    return new OMangaSettingsForm();
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }));
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new OMangaAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title ?? "").trim();
    const meta = query.metadata;

    if (meta?.topSeriesCountry) {
      const items = parseHomeTopSeries(
        await fetchPagePayload(`${getDomain()}/`, '{"korea":['),
        meta.topSeriesCountry,
      );
      const results = items.map(toSearchResultItem).filter((item) => item.imageUrl.length > 0);
      if (results.length > 0) return { items: results, metadata: undefined };
    }

    const selectedSortId = SORT_OPTIONS.some((option) => option.id === sortingOption?.id)
      ? (sortingOption?.id ?? "real_views")
      : "real_views";
    const sortId = selectedSortId === "real_views" && meta?.sort ? meta.sort : selectedSortId;

    const { items, nextMetadata } = await this.fetchCatalogPage(
      {
        q: title.length > 0 ? title : undefined,
        genre: resolveOptionValues(GENRE_OPTIONS, meta?.genres),
        excludeGenre: resolveOptionValues(GENRE_OPTIONS, meta?.excludeGenres),
        genreStrict: meta?.genreStrict ? "true" : undefined,
        type: resolveOptionValues(TYPE_OPTIONS, meta?.types),
        excludeType: resolveOptionValues(TYPE_OPTIONS, meta?.excludeTypes),
        status: meta?.statuses,
        ageRating: resolveOptionValues(AGE_RATING_OPTIONS, meta?.ageRatings),
        minRating: meta?.minRating,
        year: meta?.years,
        chaptersFrom: meta?.chaptersFrom,
        chaptersTo: meta?.chaptersTo,
        tag: meta?.tag,
        sort: sortId,
        order: "desc",
      },
      metadata,
    );

    return {
      items: items.map(toSearchResultItem).filter((item) => item.imageUrl.length > 0),
      metadata: nextMetadata,
    };
  }

  private async fetchCatalogPage(
    query: CatalogQuery,
    metadata: PageMetadata | undefined,
  ): Promise<{ items: CatalogItem[]; nextMetadata: PageMetadata | undefined }> {
    const page = metadata?.page ?? 1;
    const response = await fetchCatalog({ ...query, page: String(page) });
    const items = parseCatalogItems(response.items);
    const nextPage = response.nextPage ?? page + 1;
    const nextMetadata: PageMetadata | undefined =
      response.hasMore && items.length > 0 && nextPage > page ? { page: nextPage } : undefined;
    return { items, nextMetadata };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await this.getSeriesPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await this.getSeriesPage(sourceManga.mangaId), sourceManga);
  }

  private getSeriesPage(slug: string): Promise<string> {
    const key = `${getDomain()}/manga/${slug}`;
    if (this.seriesPageRequest?.key === key) {
      return this.seriesPageRequest.page;
    }

    const request = { key, page: this.fetchSeriesPage(slug) };
    request.page = request.page.catch((error: unknown) => {
      if (this.seriesPageRequest === request) this.seriesPageRequest = undefined;
      throw error;
    });
    this.seriesPageRequest = request;
    return request.page;
  }

  private fetchSeriesPage(slug: string): Promise<string> {
    const url = `${getDomain()}/manga/${slug}`;
    return fetchPagePayload(url, '{"initialTab"', buildSeriesNavigationHeaders(slug));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = `${getDomain()}/manga/${chapter.sourceManga.mangaId}/chapter/${chapter.chapterId}`;

    try {
      return parseChapterDetails(await fetchFlightPayload(url), chapter);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
    return parseChapterDetails(await fetchHtmlPage(url), chapter);
  }
}

export const OManga = new OMangaExtension();
