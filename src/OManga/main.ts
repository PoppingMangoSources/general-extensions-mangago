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
import { OMangaSettingsForm } from "./forms/settings";
import {
  AGE_RATING_OPTIONS,
  type CatalogItem,
  GENRE_OPTIONS,
  getDomain,
  type PageMetadata,
  resolveOptionValues,
  SORT_OPTIONS,
  TOP_SERIES_CHIPS,
  TYPE_OPTIONS,
  type SearchMetadata,
} from "./models";
import {
  buildSeriesNavigationHeaders,
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
  parseHomeCarousel,
  parseHomeLinkSection,
  parseHomeSection,
  parseHomeUpdates,
  parseMangaDetails,
  toHomeCarouselItem,
  toProminentCarouselItem,
  toSearchResultItem,
  toSimpleCarouselItem,
} from "./parsers";
import type OMangaConfig from "./pbconfig";

const FEATURED_HERO_LIMIT = 8;

const SECTION_POPULAR = "popular";
const SECTION_RANDOM = "random";
const SECTION_UPDATES = "updates";
const SECTION_TOP_SERIES = "top_series";
const SECTION_NEW_SEASON = "new_season";
const SECTION_MOST_LIKED = "most_liked";
const SECTION_BEST_ONGOING = "best_ongoing";
const SECTION_GENRES = "genres";

/** Catalog query values; repeated keys become repeated parameters. */
type CatalogQuery = Record<string, string | string[] | undefined>;

const buildCatalogUrl = (query: CatalogQuery): string => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) {
      if (single.length === 0) continue;
      parts.push(`${key}=${encodeURIComponent(single)}`);
    }
  }
  return parts.length > 0 ? `${getDomain()}/catalog?${parts.join("&")}` : `${getDomain()}/catalog`;
};

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
      if (cookie.name.startsWith("cf") || cookie.name.startsWith("__cf")) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    this.homepageRequest = undefined;
    this.seriesPageRequest = undefined;
  }

  // Mirrors the site's own front page: a Popular hero built from its weekly
  // row, the Updates feed, New Season, Most Liked, Best Ongoings, the Top
  // Series country tabs (as tappable chips), and a genre grid.
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      { id: SECTION_UPDATES, title: "Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION_TOP_SERIES, title: "Top Series", type: DiscoverSectionType.genres },
      { id: SECTION_NEW_SEASON, title: "New Season", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_MOST_LIKED, title: "Most Liked", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTION_BEST_ONGOING,
        title: "Best Ongoings",
        type: DiscoverSectionType.prominentCarousel,
      },
      { id: SECTION_RANDOM, title: "Random Picks", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_TOP_SERIES) {
      const items: DiscoverSectionItem[] = TOP_SERIES_CHIPS.map((chip) => ({
        type: "genresCarouselItem",
        name: chip.title,
        searchQuery: {
          title: "",
          metadata: { types: [chip.type], sort: "rating" } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    if (section.id === SECTION_GENRES) {
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

    // The Updates feed comes off the front page itself, chapter numbers and
    // release times included.
    if (section.id === SECTION_UPDATES) {
      return { items: parseHomeUpdates(await this.getHomepage()), metadata: undefined };
    }

    // The front page's top strip is a fresh random shuffle on every load —
    // surfaced here as its own row, rotating whenever the cached page renews.
    if (section.id === SECTION_RANDOM) {
      const items = parseHomeCarousel(await this.getHomepage());
      return {
        items: items.filter((item) => item.poster.length > 0).map(toHomeCarouselItem),
        metadata: undefined,
      };
    }

    // The hero uses listing data only; detail-page enrichment would fan out
    // into eight slow requests before Paperback can render the row.
    if (section.id === SECTION_POPULAR) {
      let items = parseHomeSection(await this.getHomepage(), "Popular This Week");
      if (items.length === 0) {
        items = (await this.fetchCatalogPage({ sort: "by_views", order: "desc" }, undefined)).items;
      }
      return { items: this.buildFeaturedItems(items), metadata: undefined };
    }

    // Most Liked renders the exact row the homepage shows, falling through to
    // its catalog feed only if the row is absent.
    if (section.id === SECTION_MOST_LIKED) {
      const homeItems = parseHomeSection(await this.getHomepage(), "Most liked");
      if (homeItems.length > 0) {
        return {
          items: homeItems.filter((item) => item.poster.length > 0).map(toHomeCarouselItem),
          metadata: undefined,
        };
      }
    }

    // New Season and Best Ongoings are element-rendered rows — parsed off the
    // front page so they carry the site's exact picks, with their catalog
    // approximations only as fallback.
    if (section.id === SECTION_NEW_SEASON) {
      const cards = parseHomeLinkSection(await this.getHomepage(), "New Season", '"hl-col-items"');
      if (cards.length > 0) {
        return {
          items: cards.map(
            (card): DiscoverSectionItem => ({
              type: "simpleCarouselItem",
              mangaId: card.slug,
              title: card.title,
              imageUrl: card.cover,
              subtitle: [card.type, card.year].filter(Boolean).join(" "),
              metadata: undefined,
            }),
          ),
          metadata: undefined,
        };
      }
    }

    if (section.id === SECTION_BEST_ONGOING) {
      const cards = parseHomeLinkSection(await this.getHomepage(), "Best Ongoings", '"grid gap-2');
      if (cards.length > 0) {
        return {
          items: cards.map(
            (card, index): DiscoverSectionItem => ({
              type: "prominentCarouselItem",
              mangaId: card.slug,
              title: card.title,
              imageUrl: card.cover,
              subtitle: `#${index + 1}`,
              metadata: undefined,
            }),
          ),
          metadata: undefined,
        };
      }
    }

    // The remaining rows are catalog queries — the same feeds the site's own
    // "More" arrows point at, so each row paginates on scroll.
    const query: CatalogQuery =
      section.id === SECTION_BEST_ONGOING
        ? { sort: "rating", order: "desc", status: "Ongoing" }
        : {
            sort:
              section.id === SECTION_NEW_SEASON
                ? "by_date"
                : section.id === SECTION_MOST_LIKED
                  ? "votes"
                  : "real_views",
            order: "desc",
          };

    const { items, nextMetadata } = await this.fetchCatalogPage(query, metadata);
    const toCarouselItem =
      section.id === SECTION_BEST_ONGOING ? toProminentCarouselItem : toSimpleCarouselItem;

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
          summary: (item.genres ?? []).slice(0, 4).join(" · "),
          infoItems: item.year ? [{ symbol: "calendar", text: String(item.year) }] : undefined,
          contentRating: getContentRatingForGenres(item.genres),
          metadata: undefined,
        }),
      );
  }

  private getHomepage(): Promise<string> {
    const domain = getDomain();
    if (this.homepageRequest?.domain === domain) {
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

    // An explicit sort pick wins; the untouched default ("Popularity") yields
    // to a query's own default sort (the Top Series chips search by rating).
    const selectedSortId = SORT_OPTIONS.some((option) => option.id === sortingOption?.id)
      ? (sortingOption?.id ?? "real_views")
      : "real_views";
    const sortId = selectedSortId === "real_views" && meta?.sort ? meta.sort : selectedSortId;

    // Selections travel as underscore-safe option ids; the catalog wants the
    // display values ("Gender_Bender" → "Gender Bender").
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

  /**
   * Fetch one catalog page and derive the next-page cursor. The first item id
   * of each page rides along in the cursor: if the next page opens with the
   * same id, the server ignored `page` and pagination ends instead of looping.
   */
  private async fetchCatalogPage(
    query: CatalogQuery,
    metadata: PageMetadata | undefined,
  ): Promise<{ items: CatalogItem[]; nextMetadata: PageMetadata | undefined }> {
    const page = metadata?.page ?? 1;
    const url = buildCatalogUrl({ ...query, page: page > 1 ? String(page) : undefined });

    const items = parseCatalogItems(await fetchPagePayload(url, '"initialItems":['));
    const firstId = items[0]?.id;

    if (page > 1 && firstId !== undefined && firstId === metadata?.firstId) {
      return { items: [], nextMetadata: undefined };
    }

    const nextMetadata: PageMetadata | undefined =
      items.length === 36 ? { page: page + 1, firstId } : undefined; // full catalog page
    return { items, nextMetadata };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await this.getSeriesPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    // The series page embeds the complete chapter list; the cache means
    // opening a title costs one request, not one per tab.
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

    // The bare payload is a fraction of the full reader page, so try it
    // first; any shortfall (blocked, reshaped, missing pages) falls back to
    // the full page.
    try {
      return parseChapterDetails(await fetchFlightPayload(url), chapter);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
    return parseChapterDetails(await fetchHtmlPage(url), chapter);
  }
}

export const OManga = new OMangaExtension();
