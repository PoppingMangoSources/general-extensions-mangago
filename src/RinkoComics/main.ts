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
  type Form,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { getHideLocked, RinkoComicsAdvancedSearchForm, RinkoComicsSettingsForm } from "./forms";
import {
  AJAX_ENDPOINT,
  CHAPTER_SELECTOR,
  CHAPTERS_PER_PAGE,
  DOMAIN,
  LOCK_SUFFIX,
  type AjaxChapterResponse,
  type ComicCard,
  type Genre,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { RinkoComicsInterceptor } from "./network";
import {
  extractNonce,
  finalizeChapters,
  genresToTagSection,
  hasNextPage,
  parseChapterDetails,
  parseChapterElements,
  parseComicCards,
  parseGenres,
  parseMangaDetails,
  parsePath,
  parsePinnedCards,
  safeDecode,
} from "./parsers";
import type RinkoComicsConfig from "./pbconfig";

const SORTING_OPTIONS: SortingOption[] = [
  { id: "newest", label: "Newest First" },
  { id: "oldest", label: "Oldest First" },
  { id: "az", label: "A-Z" },
  { id: "za", label: "Z-A" },
];

export class RinkoComicsExtension implements ExtensionImpl<typeof RinkoComicsConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  mainRequestInterceptor = new RinkoComicsInterceptor("main");
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  // Genres are scraped from the archive page filter; cache them for the
  // lifetime of the session to avoid refetching on every search form open.
  private genresList: Genre[] = [];

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainRequestInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new RinkoComicsSettingsForm();
  }

  // ----------------------------------------------------------------
  // Discover sections
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "pinned", title: "Pinned Comics", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "pinned":
        return this.getPinnedSection();
      case "latest":
        return this.getLatestSection(metadata);
      case "genres":
        return this.getGenresSection();
      default:
        return { items: [], metadata: undefined };
    }
  }

  private async getPinnedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await this.fetchCheerio({ url: `${DOMAIN}/`, method: "GET" });
    const items: DiscoverSectionItem[] = parsePinnedCards($).map((card) => ({
      type: "featuredCarouselItem",
      mangaId: card.mangaId,
      imageUrl: card.imageUrl,
      title: card.title,
      contentRating: ContentRating.EVERYONE,
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  private async getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const url = this.comicsUrl(page).setQueryItem("sort", "newest").toString();
    const $ = await this.fetchCheerio({ url, method: "GET" });

    this.cacheGenres($);
    const items: DiscoverSectionItem[] = parseComicCards($).map((card) => ({
      type: "simpleCarouselItem",
      mangaId: card.mangaId,
      imageUrl: card.imageUrl,
      title: card.title,
      contentRating: ContentRating.EVERYONE,
      metadata: undefined,
    }));

    return {
      items,
      metadata: hasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private async getGenresSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const genres = await this.getGenres();
    const items: DiscoverSectionItem[] = genres.map((genre) => ({
      type: "genresCarouselItem",
      name: genre.name,
      searchQuery: {
        title: "",
        metadata: { genres: { [genre.slug]: "included" } } satisfies SearchMetadata,
      },
      metadata: undefined,
    }));
    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new RinkoComicsAdvancedSearchForm(query, genresToTagSection(await this.getGenres()));
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const titleQuery = (query.title || "").trim();

    // Let users paste a comic link into search to open it directly.
    const pasted = await this.resolveUrlQuery(titleQuery);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const builder = this.comicsUrl(page).setQueryItem("post_type", "comic");
    if (titleQuery) builder.setQueryItem("s", titleQuery);

    const includedGenres = Object.entries(query.metadata?.genres ?? {})
      .filter(([, state]) => state === "included")
      .map(([slug]) => slug);
    if (includedGenres.length > 0) builder.setQueryItem("genres[]", includedGenres);

    if (sortingOption?.id) builder.setQueryItem("sort", sortingOption.id);

    const $ = await this.fetchCheerio({ url: builder.toString(), method: "GET" });
    this.cacheGenres($);

    const items: SearchResultItem[] = parseComicCards($).map((card: ComicCard) => ({
      mangaId: card.mangaId,
      imageUrl: card.imageUrl,
      title: card.title,
      contentRating: ContentRating.EVERYONE,
    }));

    return {
      items,
      metadata: hasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  // Resolves a pasted `rinkocomics.com` comic link to a single result.
  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    if (!/^https?:\/\/[^/]*rinkocomics\.com\//i.test(query)) return undefined;
    const mangaId = parsePath(query);
    if (!mangaId) return undefined;

    try {
      const manga = await this.getMangaDetails(mangaId);
      return {
        items: [
          {
            mangaId: manga.mangaId,
            title: manga.mangaInfo.primaryTitle,
            imageUrl: manga.mangaInfo.thumbnailUrl,
            contentRating: ContentRating.EVERYONE,
          },
        ],
        metadata: undefined,
      };
    } catch {
      return undefined;
    }
  }

  // ----------------------------------------------------------------
  // Manga details & chapters
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetchCheerio({ url: this.mangaUrl(mangaId), method: "GET" });
    return parseMangaDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await this.fetchCheerio({ url: this.mangaUrl(sourceManga.mangaId), method: "GET" });
    const hideLocked = getHideLocked();

    const chapters = new Map<string, Chapter>();
    const addAll = (items: Chapter[]) => {
      for (const chapter of items) {
        if (!chapters.has(chapter.chapterId)) chapters.set(chapter.chapterId, chapter);
      }
    };

    addAll(parseChapterElements($, $(CHAPTER_SELECTOR), sourceManga, hideLocked));

    // The theme lazy-loads the rest of the chapter list through admin-ajax.
    const loadMoreBtn = $("#loadMoreChaptersBtn").first();
    const comicId = (loadMoreBtn.attr("data-comic-id") || "").trim();
    const nonce = extractNonce($) || "";
    let offset = parseInt(loadMoreBtn.attr("data-offset") || "", 10);
    if (isNaN(offset) || offset <= 0) {
      offset = chapters.size;
    } else if (chapters.size > 0 && offset > chapters.size) {
      offset = chapters.size;
    }

    if (comicId && nonce) {
      for (;;) {
        const before = chapters.size;
        const items = await this.fetchMoreChapters(comicId, offset, nonce, sourceManga, hideLocked);
        if (items.length === 0) break;
        addAll(items);
        offset += CHAPTERS_PER_PAGE;
        // Guard against a server that keeps returning the same page.
        if (chapters.size === before) break;
      }
    }

    return finalizeChapters(Array.from(chapters.values()));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapter.chapterId.includes(LOCK_SUFFIX)) {
      throw new Error("This chapter is locked. Use the WebView to purchase it.");
    }
    const $ = await this.fetchCheerio({ url: this.chapterUrl(chapter.chapterId), method: "GET" });
    return parseChapterDetails($, chapter);
  }

  // ----------------------------------------------------------------
  // Cloudflare
  // ----------------------------------------------------------------

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
  // Helpers
  // ----------------------------------------------------------------

  private comicsUrl(page: number): URL {
    return new URL(DOMAIN).setPath(page <= 1 ? "/comic/" : `/comic/page/${page}/`);
  }

  private mangaUrl(mangaId: string): string {
    const slug = safeDecode(mangaId);
    if (slug.startsWith("http")) return slug;
    return `${DOMAIN}/${slug.replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    const slug = safeDecode(chapterId.replace(LOCK_SUFFIX, ""));
    if (slug.startsWith("http")) return slug;
    return `${DOMAIN}/${slug.replace(/^\/+/, "")}`;
  }

  private async getGenres(): Promise<Genre[]> {
    if (this.genresList.length > 0) return this.genresList;
    const $ = await this.fetchCheerio({ url: this.comicsUrl(1).toString(), method: "GET" });
    this.cacheGenres($);
    return this.genresList;
  }

  private cacheGenres($: cheerio.CheerioAPI): void {
    if (this.genresList.length > 0) return;
    const genres = parseGenres($);
    if (genres.length > 0) this.genresList = genres;
  }

  private async fetchMoreChapters(
    comicId: string,
    offset: number,
    nonce: string,
    sourceManga: SourceManga,
    hideLocked: boolean,
  ): Promise<Chapter[]> {
    const body = [
      "action=load_more_chapters",
      `nonce=${encodeURIComponent(nonce)}`,
      `comic_id=${encodeURIComponent(comicId)}`,
      `offset=${offset}`,
    ].join("&");

    const [response, data] = await Application.scheduleRequest({
      url: AJAX_ENDPOINT,
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
      body,
    });
    if (response.status !== 200) return [];

    let parsed: AjaxChapterResponse;
    try {
      parsed = JSON.parse(Application.arrayBufferToUTF8String(data)) as AjaxChapterResponse;
    } catch {
      return [];
    }

    if (parsed.success !== true) return [];
    const html = parsed.data?.html ?? "";
    if (!html) return [];

    const $ = cheerio.load(html);
    return parseChapterElements($, $(CHAPTER_SELECTOR), sourceManga, hideLocked);
  }

  async fetchCheerio(request: Request): Promise<cheerio.CheerioAPI> {
    const [response, data] = await Application.scheduleRequest(request);
    if (response.status === 404) {
      throw new Error(`Content not found: ${request.url}`);
    }
    return cheerio.load(Application.arrayBufferToUTF8String(data), {
      xml: {
        xmlMode: false,
        decodeEntities: false,
      },
    });
  }
}

export const RinkoComics = new RinkoComicsExtension();
