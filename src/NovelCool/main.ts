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
  type PagedResults,
  type Request,
  type Response,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { NovelCoolAdvancedSearchForm } from "./forms";
import {
  CATEGORY_PATHS,
  DOMAIN,
  PAGE_SIZE,
  SECTIONS,
  SORT_OPTIONS,
  STATE_KEYS,
  type BrowseOrder,
  type PageMetadata,
  type SearchMetadata,
  type SearchOptions,
} from "./models";
import {
  fetchBookChapters,
  fetchBookInfo,
  fetchBookSearch,
  fetchBrowse,
  fetchCategoryPage,
  fetchChapterInfo,
  fetchSearchPage,
  fetchUrlPage,
  NovelCoolInterceptor,
} from "./network";
import {
  bookIdToUrl,
  hasNextPage,
  parseApiListings,
  parseBookId,
  parseChapterDetails,
  parseChapters,
  parseFeatured,
  parseListings,
  parseMangaDetails,
  parseSearchOptions,
  pickTriState,
  toFeaturedItem,
  toLatestItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type NovelCoolConfig from "./pbconfig";

const browseOrderForSort = (sortId?: string): BrowseOrder => {
  switch (sortId) {
    case "popular":
      return "hot";
    case "newest":
      return "new_book";
    default:
      return "latest";
  }
};

class NovelCoolExtension implements ExtensionImpl<typeof NovelCoolConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new NovelCoolInterceptor("main");
  private searchOptionsPromise?: Promise<SearchOptions>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
    Application.setRedirectHandler(
      Application.Selector(this as NovelCoolExtension, "handleRedirect"),
    );
    if (Application.getState(STATE_KEYS.RELATIVE_DATE_ANCHOR) == null) {
      Application.setState(Date.now(), STATE_KEYS.RELATIVE_DATE_ANCHOR);
    }
  }

  async handleRedirect(request: Request, response: Response): Promise<Request | undefined> {
    return this.interceptor.prepareRedirect(request, response);
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
    this.searchOptionsPromise = undefined;
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
      { id: SECTIONS.LATEST, title: "Latest", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.COMPLETED, title: "Completed", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.FEATURED:
        return this.getFeaturedSection();
      case SECTIONS.LATEST:
        return this.getLatestSection(metadata);
      case SECTIONS.POPULAR:
        return this.getApiSection("hot", metadata, toSimpleItem);
      case SECTIONS.COMPLETED:
        return this.getHtmlSection(CATEGORY_PATHS.COMPLETED, metadata);
      default:
        return { items: [] };
    }
  }

  private async getFeaturedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: parseFeatured(await fetchUrlPage(DOMAIN))
        .filter((item) => item.imageUrl.length > 0)
        .map(toFeaturedItem),
    };
  }

  private getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return this.getApiSection("latest", metadata, (item) => toLatestItem(item, this.dateAnchor()));
  }

  private async getApiSection(
    order: BrowseOrder,
    metadata: PageMetadata | undefined,
    mapper: (item: ReturnType<typeof parseApiListings>[number]) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const items = await this.getBrowseItems(order, page);
    return {
      items: items.filter((item) => item.imageUrl.length > 0).map(mapper),
      metadata: items.length >= PAGE_SIZE ? { page: page + 1 } : undefined,
    };
  }

  private async getHtmlSection(
    path: string,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchCategoryPage(path, page);
    return {
      items: parseListings(document)
        .filter((item) => item.imageUrl.length > 0)
        .map(toSimpleItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async getBrowseItems(order: BrowseOrder, page: number) {
    const [novels, manga] = await Promise.all([
      fetchBrowse(order, "novel", page),
      fetchBrowse(order, "manga", page),
    ]);
    const seen = new Set<string>();
    return parseApiListings([...(novels.list ?? []), ...(manga.list ?? [])]).filter((item) => {
      if (seen.has(item.mangaId)) return false;
      seen.add(item.mangaId);
      return true;
    });
  }

  private getSearchOptions(): Promise<SearchOptions> {
    return (this.searchOptionsPromise ??= fetchSearchPage({ page: 1 }).then(parseSearchOptions));
  }

  private dateAnchor(): number {
    const existing = Application.getState(STATE_KEYS.RELATIVE_DATE_ANCHOR) as number | undefined;
    if (existing != null) return existing;
    const created = Date.now();
    Application.setState(created, STATE_KEYS.RELATIVE_DATE_ANCHOR);
    return created;
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new NovelCoolAdvancedSearchForm(query, await this.getSearchOptions());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const searchMetadata = query.metadata ?? {};
    const title = (query.title ?? "").trim();
    const hasAdvancedFilters =
      Boolean(searchMetadata.author) ||
      Boolean(searchMetadata.status?.length) ||
      Boolean(searchMetadata.year?.length) ||
      Boolean(searchMetadata.rating?.length) ||
      Object.keys(searchMetadata.genres ?? {}).length > 0 ||
      Boolean(searchMetadata.nameMethod?.length) ||
      Boolean(searchMetadata.authorMethod?.length);

    if (title && !hasAdvancedFilters) {
      const [novels, manga] = await Promise.all([
        fetchBookSearch(title, "novel", page),
        fetchBookSearch(title, "manga", page),
      ]);
      const items = parseApiListings([...(novels.list ?? []), ...(manga.list ?? [])]);
      return {
        items: items.filter((item) => item.imageUrl.length > 0).map(toSearchResultItem),
        metadata: items.length >= PAGE_SIZE ? { page: page + 1 } : undefined,
      };
    }

    if (!title && !hasAdvancedFilters && sortingOption?.id !== "rating") {
      const items = await this.getBrowseItems(browseOrderForSort(sortingOption?.id), page);
      return {
        items: items.filter((item) => item.imageUrl.length > 0).map(toSearchResultItem),
        metadata: items.length >= PAGE_SIZE ? { page: page + 1 } : undefined,
      };
    }

    const document =
      sortingOption?.id === "rating" && !title && !hasAdvancedFilters
        ? await fetchCategoryPage(CATEGORY_PATHS.RATING, page)
        : await fetchSearchPage({
            page,
            title: title || undefined,
            nameMethod: searchMetadata.nameMethod?.[0],
            author: searchMetadata.author,
            authorMethod: searchMetadata.authorMethod?.[0],
            status: searchMetadata.status?.[0],
            genresInclude: pickTriState(searchMetadata.genres, "included"),
            genresExclude: pickTriState(searchMetadata.genres, "excluded"),
            year: searchMetadata.year?.[0],
            rating: searchMetadata.rating?.[0],
          });
    return {
      items: parseListings(document)
        .filter((item) => item.imageUrl.length > 0)
        .map(toSearchResultItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query
      .trim()
      .match(/^https?:\/\/(?:(?:www|en)\.)?novelcool\.com(\/novel\/[^?#]+\.html)\/?$/i)?.[0];
    if (!url) return undefined;
    try {
      const mangaId = parseBookId(await fetchUrlPage(url));
      const book = (await fetchBookInfo(mangaId)).info;
      if (!book) return undefined;
      const manga = parseMangaDetails(book, mangaId);
      return {
        items: [
          {
            mangaId,
            title: manga.mangaInfo.primaryTitle,
            imageUrl: manga.mangaInfo.thumbnailUrl,
            contentRating: manga.mangaInfo.contentRating,
          },
        ],
      };
    } catch (error: unknown) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const book = (await fetchBookInfo(await this.resolveBookId(mangaId))).info;
    if (!book) throw new Error(`NovelCool returned no details for book ${mangaId}.`);
    return parseMangaDetails(book, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const bookId = await this.resolveBookId(sourceManga.mangaId);
    return parseChapters((await fetchBookChapters(bookId)).list ?? [], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const info = (await fetchChapterInfo(chapter.chapterId)).info;
    if (!info) throw new Error(`NovelCool returned no content for chapter ${chapter.chapterId}.`);
    return parseChapterDetails(info, chapter);
  }

  private async resolveBookId(mangaId: string): Promise<string> {
    if (/^\d+$/.test(mangaId)) return mangaId;
    const url = bookIdToUrl(mangaId);
    if (!url) throw new Error(`NovelCool returned an unsupported book id: ${mangaId}.`);
    return parseBookId(await fetchUrlPage(url));
  }
}

export const NovelCool = new NovelCoolExtension();
