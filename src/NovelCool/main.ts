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
  SECTIONS,
  SORT_OPTIONS,
  STATE_KEYS,
  type PageMetadata,
  type SearchMetadata,
  type SearchOptions,
} from "./models";
import {
  fetchCategoryPage,
  fetchChapterPage,
  fetchContentPage,
  fetchHomePage,
  fetchReaderPage,
  fetchSearchPage,
  NovelCoolInterceptor,
} from "./network";
import {
  hasNextPage,
  parseChapterDetails,
  parseChapters,
  encodePathId,
  parseFeatured,
  parseListings,
  parseMangaDetails,
  parseReaderImages,
  parseReaderPageUrls,
  parseSearchOptions,
  pickTriState,
  toFeaturedItem,
  toLatestItem,
  toSearchResultItem,
  toSimpleItem,
  typeTags,
} from "./parsers";
import type NovelCoolConfig from "./pbconfig";

const categoryPathForSort = (sortId?: string): string => {
  switch (sortId) {
    case "popular":
      return CATEGORY_PATHS.POPULAR;
    case "newest":
      return CATEGORY_PATHS.NEWEST;
    case "rating":
      return CATEGORY_PATHS.RATING;
    default:
      return CATEGORY_PATHS.LATEST;
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
  private homePromise?: ReturnType<typeof fetchHomePage>;
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
    this.homePromise = undefined;
    this.searchOptionsPromise = undefined;
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
      { id: SECTIONS.LATEST, title: "Latest", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.COMPLETED, title: "Completed", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.TYPES, title: "Types", type: DiscoverSectionType.genres },
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
        return this.getListingSection(CATEGORY_PATHS.POPULAR, metadata, toSimpleItem);
      case SECTIONS.COMPLETED:
        return this.getListingSection(CATEGORY_PATHS.COMPLETED, metadata, toSimpleItem);
      case SECTIONS.TYPES:
        return this.getTypeSection();
      default:
        return { items: [] };
    }
  }

  private getHomePage(): ReturnType<typeof fetchHomePage> {
    return (this.homePromise ??= fetchHomePage());
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

  private async getFeaturedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: parseFeatured(await this.getHomePage())
        .filter((item) => item.imageUrl.length > 0)
        .map(toFeaturedItem),
    };
  }

  private async getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return this.getListingSection(CATEGORY_PATHS.LATEST, metadata, (item) =>
      toLatestItem(item, this.dateAnchor()),
    );
  }

  private async getListingSection(
    path: string,
    metadata: PageMetadata | undefined,
    mapper: (item: ReturnType<typeof parseListings>[number]) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchCategoryPage(path, page);
    return {
      items: parseListings(document)
        .filter((item) => item.imageUrl.length > 0)
        .map(mapper),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async getTypeSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: typeTags(await this.getSearchOptions()).map(
        (tag): DiscoverSectionItem => ({
          type: "genresCarouselItem",
          name: tag.title,
          searchQuery: {
            title: "",
            metadata: { genres: { [tag.id]: "included" } } satisfies SearchMetadata,
          },
        }),
      ),
    };
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
    const hasFilters =
      Boolean(title) ||
      Boolean(searchMetadata.author) ||
      Boolean(searchMetadata.status?.length) ||
      Boolean(searchMetadata.year?.length) ||
      Boolean(searchMetadata.rating?.length) ||
      Object.keys(searchMetadata.genres ?? {}).length > 0;
    const document = hasFilters
      ? await fetchSearchPage({
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
        })
      : await fetchCategoryPage(categoryPathForSort(sortingOption?.id), page);

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
    const path = query
      .trim()
      .match(/^https?:\/\/(?:(?:www|en)\.)?novelcool\.com(\/novel\/[^?#]+\.html)\/?$/i)?.[1];
    if (!path) return undefined;
    const mangaId = encodePathId(path);
    try {
      const manga = parseMangaDetails(await fetchContentPage(mangaId), mangaId);
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
    return parseMangaDetails(await fetchContentPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchContentPage(sourceManga.mangaId), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const initial = await fetchChapterPage(chapter.chapterId);
    const direct = parseChapterDetails(initial.$, initial.url, chapter);
    if (direct) return direct;

    const pageUrls = parseReaderPageUrls(initial.$, initial.url);
    if (pageUrls.length === 0) {
      throw new Error(`No readable content found for ${chapter.chapterId}.`);
    }
    const pages = (
      await Promise.all(pageUrls.map((url) => fetchReaderPage(url, initial.url)))
    ).flatMap((page) => parseReaderImages(page.$, page.url));
    const uniquePages = [...new Set(pages)];
    if (uniquePages.length === 0) {
      throw new Error(`No readable pages found for ${chapter.chapterId}.`);
    }
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: uniquePages,
    };
  }
}

export const NovelCool = new NovelCoolExtension();
