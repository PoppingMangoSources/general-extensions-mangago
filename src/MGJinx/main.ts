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

import { getBaseUrl, MGJinxAdvancedSearchForm, MGJinxSettingsForm } from "./forms";
import {
  GENRES,
  SECTIONS,
  SORTING_OPTIONS,
  TOP_RANGES,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchHtml, MGJinxInterceptor } from "./network";
import {
  contentRatingForGenres,
  decodeSlugId,
  encodeSlugId,
  hasNextPage,
  parseCards,
  parseChapterList,
  parseChapterPages,
  parseHotCells,
  parseMangaDetails,
  toFeaturedItems,
  toLatestItems,
  toRankedItems,
  toSearchResultItems,
} from "./parsers";
import type MGJinxConfig from "./pbconfig";

class MGJinxExtension implements ExtensionImpl<typeof MGJinxConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new MGJinxInterceptor("main");

  private homePage?: { base: string; promise: Promise<string> };

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new MGJinxSettingsForm();
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
      { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      { id: SECTIONS.TOP, title: "Top Manga", type: DiscoverSectionType.genres },
      { id: SECTIONS.HOT, title: "Hot Updates", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.NEWEST, title: "Newest", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.REVIEWS, title: "Top Reviewed", type: DiscoverSectionType.simpleCarousel },
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
      case SECTIONS.POPULAR:
        return this.getPopularSection();
      case SECTIONS.TOP:
        return { items: this.topRangeChips(), metadata: undefined };
      case SECTIONS.HOT:
        return this.getHotSection();
      case SECTIONS.LATEST:
        return this.getLatestSection(metadata);
      case SECTIONS.NEWEST:
        return this.getListingSection(`${getBaseUrl()}/newest`, "chapter");
      case SECTIONS.REVIEWS:
        return this.getListingSection(`${getBaseUrl()}/top/reviews`, "rating");
      case SECTIONS.GENRES:
        return { items: this.genreChips(), metadata: undefined };
      default:
        return { items: [], metadata: undefined };
    }
  }

  private async getPopularSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchHtml(`${getBaseUrl()}/popular`);
    return { items: toFeaturedItems(parseCards(html)), metadata: undefined };
  }

  private async getHotSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const cards = parseHotCells(await this.getHomePage());
    return { items: toRankedItems(cards, "chapter", false), metadata: undefined };
  }

  private async getListingSection(
    url: string,
    detail: "chapter" | "views" | "rating",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchHtml(url);
    return { items: toRankedItems(parseCards(html), detail), metadata: undefined };
  }

  // The homepage grid embeds a metadata block carrying the update timestamp
  // each listing page omits, so page one comes from there and deeper pages
  // fall back to the listing with the overlap filtered out.
  private async getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;

    if (page === 1) {
      const items = toLatestItems(parseCards(await this.getHomePage()));
      if (items.length > 0) {
        const seen = items.flatMap((item) => ("mangaId" in item ? [item.mangaId] : []));
        return { items, metadata: { page: 2, seen } };
      }
    }

    const listingPage = Math.max(1, page - 1);
    const html = await fetchHtml(`${getBaseUrl()}/latest?page=${listingPage}`);
    const seen = new Set(metadata?.seen ?? []);
    const items = toLatestItems(parseCards(html)).filter(
      (item) => !("mangaId" in item) || !seen.has(item.mangaId),
    );

    return { items, metadata: hasNextPage(html) ? { page: page + 1 } : undefined };
  }

  // Chips run through search so the ranking pages stay pageable in place of a
  // carousel that could only ever show its first page.
  private topRangeChips(): DiscoverSectionItem[] {
    return TOP_RANGES.map((range) => ({
      type: "genresCarouselItem",
      name: range.title,
      searchQuery: {
        title: "",
        metadata: { topRange: range.id } satisfies SearchMetadata,
      },
      metadata: undefined,
    }));
  }

  private genreChips(): DiscoverSectionItem[] {
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
      // A failed fetch must not stay memoized, or the sections it feeds would
      // remain empty until the app restarts.
      promise.catch(() => {
        if (this.homePage === entry) this.homePage = undefined;
      });
      this.homePage = entry;
    }
    return this.homePage.promise;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MGJinxAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const range = query.metadata?.topRange;
    const url = range
      ? `${getBaseUrl()}/top/${encodeURIComponent(range)}?page=${page}`
      : this.buildSearchUrl(query, sortingOption, page);
    const html = await fetchHtml(url);

    return {
      items: toSearchResultItems(parseCards(html)),
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
    const host = getBaseUrl().replace(/^https?:\/\//, "");
    const pattern = new RegExp(
      `^https?://(?:www\\.)?(?:mgjinx\\.com|${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})/manga/([^/?#]+)`,
      "i",
    );
    const slug = pattern.exec(query.trim())?.[1];
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
    // The detail page renders a truncated list; this fragment is the whole one.
    // The trailing slash is required — without it the server answers with the
    // page shell instead of the fragment.
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

export const MGJinx = new MGJinxExtension();
