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
import * as cheerio from "cheerio";

import { getHideLocked, RinkoComicsAdvancedSearchForm, RinkoComicsSettingsForm } from "./forms";
import {
  CHAPTER_SELECTOR,
  DOMAIN,
  LOCK_SUFFIX,
  SORTING_OPTIONS,
  type ComicCard,
  type Genre,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchCheerio, fetchMoreChaptersHtml, RinkoComicsInterceptor } from "./network";
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
  safeDecode,
  toHotItems,
  toLatestItems,
  toNovelItems,
  toPinnedItems,
} from "./parsers";
import type RinkoComicsConfig from "./pbconfig";

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

  private genresPromise?: Promise<Genre[]>;
  private homePromise?: Promise<cheerio.CheerioAPI>;

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainRequestInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new RinkoComicsSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "hot", title: "Hot This Week", type: DiscoverSectionType.featured },
      { id: "pinned", title: "Editor's Choice", type: DiscoverSectionType.prominentCarousel },
      { id: "latest", title: "Latest Releases", type: DiscoverSectionType.chapterUpdates },
      { id: "novels", title: "Latest Novels", type: DiscoverSectionType.prominentCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      return this.getGenresSection();
    }
    const $ = await this.getHomePage();
    switch (section.id) {
      case "hot":
        return { items: toHotItems($) };
      case "pinned":
        return { items: toPinnedItems($) };
      case "latest":
        return { items: toLatestItems($) };
      case "novels":
        return { items: toNovelItems($) };
      default:
        return { items: [] };
    }
  }

  // The four homepage sections share one document; dedupe the fetch within a
  // refresh burst while still loading fresh data on the next refresh.
  private getHomePage(): Promise<cheerio.CheerioAPI> {
    this.homePromise ??= fetchCheerio({ url: `${DOMAIN}/`, method: "GET" }).finally(() => {
      this.homePromise = undefined;
    });
    return this.homePromise;
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

    const $ = await fetchCheerio({ url: builder.toString(), method: "GET" });
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
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await fetchCheerio({ url: this.mangaUrl(mangaId), method: "GET" });
    return parseMangaDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await fetchCheerio({ url: this.mangaUrl(sourceManga.mangaId), method: "GET" });

    // Collect every chapter (locked included) so AJAX pages made up entirely
    // of locked chapters don't look like end-of-data; the hide-locked filter
    // is applied once over the final list instead.
    const chapters = new Map<string, Chapter>();
    const addAll = (items: Chapter[]) => {
      for (const chapter of items) {
        if (!chapters.has(chapter.chapterId)) chapters.set(chapter.chapterId, chapter);
      }
    };

    addAll(parseChapterElements($, $(CHAPTER_SELECTOR), sourceManga));

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
        const items = await this.fetchMoreChapters(comicId, offset, nonce, sourceManga);
        if (items.length === 0) break;
        addAll(items);
        offset += items.length;
        if (chapters.size === before) break;
      }
    }

    let list = Array.from(chapters.values());
    if (getHideLocked()) {
      list = list.filter((chapter) => !chapter.chapterId.includes(LOCK_SUFFIX));
    }
    return finalizeChapters(list);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapter.chapterId.includes(LOCK_SUFFIX)) {
      throw new Error("This chapter is locked. Use the WebView to purchase it.");
    }
    const $ = await fetchCheerio({ url: this.chapterUrl(chapter.chapterId), method: "GET" });
    return parseChapterDetails($, chapter);
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
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

  private comicsUrl(page: number): URL {
    return new URL(DOMAIN).setPath(page <= 1 ? "/comic/" : `/comic/page/${page}/`);
  }

  private mangaUrl(mangaId: string): string {
    return `${DOMAIN}/${safeDecode(mangaId).replace(/^\/+/, "")}`;
  }

  private chapterUrl(chapterId: string): string {
    return `${DOMAIN}/${safeDecode(chapterId).replace(/^\/+/, "")}`;
  }

  private getGenres(): Promise<Genre[]> {
    this.genresPromise ??= fetchCheerio({
      url: this.comicsUrl(1).toString(),
      method: "GET",
    })
      .then(($) => parseGenres($))
      .catch((error: unknown) => {
        this.genresPromise = undefined;
        throw error;
      });
    return this.genresPromise;
  }

  private cacheGenres($: cheerio.CheerioAPI): void {
    if (this.genresPromise) return;
    const genres = parseGenres($);
    if (genres.length > 0) this.genresPromise = Promise.resolve(genres);
  }

  private async fetchMoreChapters(
    comicId: string,
    offset: number,
    nonce: string,
    sourceManga: SourceManga,
  ): Promise<Chapter[]> {
    const html = await fetchMoreChaptersHtml(comicId, offset, nonce);
    if (!html) return [];
    const $ = cheerio.load(html);
    return parseChapterElements($, $(CHAPTER_SELECTOR), sourceManga);
  }
}

export const RinkoComics = new RinkoComicsExtension();
