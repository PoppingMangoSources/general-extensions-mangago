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

import { getBaseUrl, KaliScanAdvancedSearchForm, KaliScanSettingsForm } from "./forms";
import {
  GENRES,
  SECTIONS,
  SORTING_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchHtml, KaliScanInterceptor } from "./network";
import {
  contentRatingForGenres,
  decodeSlugId,
  encodeSlugId,
  hasNextPage,
  parseChapterList,
  parseChapterPages,
  parseDetailedCards,
  parseHotCells,
  parseGridEntries,
  parseMangaDetails,
  toFeaturedItems,
  toLatestGridItems,
  toLatestItems,
  toRankedCardItems,
  toSearchResultItems,
} from "./parsers";
import type KaliScanConfig from "./pbconfig";

class KaliScanExtension implements ExtensionImpl<typeof KaliScanConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new KaliScanInterceptor("main");

  private homePage?: { base: string; promise: Promise<string> };

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new KaliScanSettingsForm();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.homePage = undefined;
    // Forward every cookie: the backend chapter-list fragment sits behind the
    // same session cookies as the pages, so a clearance-only filter would let
    // browsing recover while chapter lists stay challenged.
    for (const cookie of cookies) {
      this.cookieStorageInterceptor.setCookie(cookie);
    }
    Application.invalidateDiscoverSections();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.TOP_WEEK, title: "Top of the Week", type: DiscoverSectionType.featured },
      { id: SECTIONS.HOT, title: "Hot Updates", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.REVIEWS,
        title: "Most Talked About",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.MOST_VIEWED,
        title: "Most Viewed",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.EDITORS, title: "Editor's Choice", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.TOP_WEEK:
        return this.getTopSection("week");
      case SECTIONS.HOT:
        return this.getHotSection();
      case SECTIONS.LATEST:
        return this.getLatestSection(metadata);
      case SECTIONS.TRENDING:
        return this.getTopSection("day");
      case SECTIONS.REVIEWS:
        return this.getRankedSection(`${getBaseUrl()}/top/reviews`, "views");
      case SECTIONS.MOST_VIEWED:
        return this.getRankedSection(`${getBaseUrl()}/az-list`, "views");
      case SECTIONS.EDITORS:
        return this.getRankedSection(`${getBaseUrl()}/top/comments`, "chapter");
      case SECTIONS.GENRES:
        return { items: this.genreChipItems(), metadata: undefined };
      default:
        return { items: [], metadata: undefined };
    }
  }

  private async getTopSection(range: "day" | "week"): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchHtml(`${getBaseUrl()}/top/${range}`);
    return { items: toFeaturedItems(parseDetailedCards(html)), metadata: undefined };
  }

  private async getHotSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await this.getHomePage();
    const cards = parseHotCells(html);
    return { items: toRankedCardItems(cards, "chapter"), metadata: undefined };
  }

  // The first page comes from the homepage grid, whose embedded metadata
  // carries timestamps and ratings the listing page omits; deeper pages come
  // from the listing with the overlap filtered out.
  private async getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;

    if (page === 1) {
      const items = toLatestGridItems(parseGridEntries(await this.getHomePage()));
      if (items.length > 0) {
        const seen = items.flatMap((item) => ("mangaId" in item ? [item.mangaId] : []));
        return { items, metadata: { page: 2, seen } };
      }
    }

    const listingPage = Math.max(1, page - 1);
    const html = await fetchHtml(`${getBaseUrl()}/latest?page=${listingPage}`);
    const seen = new Set(metadata?.seen ?? []);
    const items = toLatestItems(parseDetailedCards(html)).filter(
      (item) => !("mangaId" in item) || !seen.has(item.mangaId),
    );

    return {
      items,
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  private async getRankedSection(
    url: string,
    detail: "views" | "chapter",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchHtml(url);
    const cards = parseDetailedCards(html);
    return { items: toRankedCardItems(cards, detail), metadata: undefined };
  }

  private genreChipItems(): DiscoverSectionItem[] {
    return GENRES.map((genre) => ({
      type: "genresCarouselItem",
      name: genre.value,
      searchQuery: {
        title: "",
        metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
      },
      contentRating: contentRatingForGenres([genre.value]),
      metadata: undefined,
    }));
  }

  private getHomePage(): Promise<string> {
    const base = getBaseUrl();
    if (this.homePage?.base !== base) this.homePage = undefined;

    if (!this.homePage) {
      const promise = fetchHtml(`${base}/home`);
      const entry = { base, promise };
      // A failed fetch must not stay memoized, or the section it feeds would
      // remain empty until the app restarts.
      promise.catch(() => {
        if (this.homePage === entry) this.homePage = undefined;
      });
      this.homePage = entry;
    }
    return this.homePage.promise;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new KaliScanAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const html = await fetchHtml(this.buildSearchUrl(query, sortingOption, page));

    return {
      items: toSearchResultItems(parseDetailedCards(html)),
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchUrl(
    query: SearchQuery<SearchMetadata>,
    sortingOption: SortingOption | undefined,
    page: number,
  ): string {
    const meta = query.metadata;
    const params: string[] = [`page=${page}`];

    const term = (query.title ?? "").trim();
    if (term) params.push(`q=${encodeURIComponent(term)}`);
    if (sortingOption?.id) params.push(`sort=${encodeURIComponent(sortingOption.id)}`);

    const status = meta?.status?.[0];
    if (status && status !== "all") params.push(`status=${encodeURIComponent(status)}`);

    if (meta?.author) params.push(`author=${encodeURIComponent(meta.author)}`);

    const genres = Object.entries(meta?.genres ?? {});
    for (const [id, state] of genres) {
      const key = state === "included" ? "include[]" : "exclude[]";
      params.push(`${encodeURIComponent(key)}=${encodeURIComponent(id)}`);
    }
    if (genres.some(([, state]) => state === "included")) {
      params.push(`include_mode=${encodeURIComponent(meta?.genreMode?.[0] ?? "and")}`);
    }

    return `${getBaseUrl()}/search?${params.join("&")}`;
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const trimmed = query.trim();
    const host = getBaseUrl().replace(/^https?:\/\//, "");
    const pattern = new RegExp(
      `^https?://(?:www\\.)?(?:kaliscan\\.io|${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})/manga/([^/?#]+)`,
      "i",
    );
    const slug = pattern.exec(trimmed)?.[1];
    if (!slug) return undefined;

    const manga = await this.getMangaDetails(encodeSlugId(decodeURIComponent(slug)));
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
    const html = await fetchHtml(`${getBaseUrl()}/manga/${decodeSlugId(mangaId)}`);
    return parseMangaDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const numericId = /^\d+/.exec(decodeSlugId(sourceManga.mangaId))?.[0];
    if (!numericId) {
      throw new Error(`Cannot derive a chapter list id from ${sourceManga.mangaId}`);
    }
    // The trailing slash is required — without it the server answers with the
    // page shell instead of the chapter-list fragment.
    const html = await fetchHtml(`${getBaseUrl()}/service/backend/chaplist/?manga_id=${numericId}`);
    return parseChapterList(html, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const slug = decodeSlugId(chapter.sourceManga.mangaId);
    const chapterSlug = decodeSlugId(chapter.chapterId);
    const html = await fetchHtml(`${getBaseUrl()}/manga/${slug}/${chapterSlug}`);
    return parseChapterPages(html, chapter);
  }
}

export const KaliScan = new KaliScanExtension();
