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
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import { CocomicAdvancedSearchForm } from "./forms";
import {
  SECTIONS,
  SORT_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
  type SearchRequest,
} from "./models";
import {
  CocomicInterceptor,
  fetchBrowsePage,
  fetchChapterList,
  fetchHomePage,
  fetchLatestPage,
  fetchMangaPage,
  fetchReaderPage,
  fetchSearchPage,
} from "./network";
import {
  hasNextPage,
  parseChapterDetails,
  parseChapters,
  parseGenreTags,
  parseHomepageRail,
  parseMangaDetails,
  parseMangaId,
  parseMangaList,
  toChapterUpdateItem,
  toFeaturedItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type CocomicConfig from "./pbconfig";

const includedValues = (value: SearchMetadata["genres"]): string[] =>
  Object.entries(value ?? {})
    .filter(([, state]) => state === "included")
    .map(([id]) => id);

class CocomicExtension implements ExtensionImpl<typeof CocomicConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 1,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new CocomicInterceptor("main");
  private homePromise?: ReturnType<typeof fetchHomePage>;
  private genresPromise?: Promise<Tag[]>;

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
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    this.homePromise = undefined;
    this.genresPromise = undefined;
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.ONLY_COCOMIC,
        title: "Only Cocomic",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.NEW_RELEASES,
        title: "New Releases",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.LATEST_UPDATES,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: SECTIONS.TODAYS_OFFICIAL,
        title: "Today's Official",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.YAOI, title: "Yaoi", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.MANHWA, title: "Manhwa", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.SMUT, title: "Smut", type: DiscoverSectionType.simpleCarousel },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.TOP_RATED:
        return this.getTopRated(metadata);
      case SECTIONS.ONLY_COCOMIC:
        return this.getHomepageRail("Only Cocomic");
      case SECTIONS.NEW_RELEASES:
        return this.getHomepageRail("New Releases");
      case SECTIONS.LATEST_UPDATES:
        return this.getLatestUpdates(metadata);
      case SECTIONS.TODAYS_OFFICIAL:
        return this.getHomepageRail("Today's Official");
      case SECTIONS.YAOI:
        return this.getHomepageRail("Yaoi");
      case SECTIONS.MANHWA:
        return this.getHomepageRail("Manhwa");
      case SECTIONS.SMUT:
        return this.getHomepageRail("Smut");
      default:
        return { items: [] };
    }
  }

  private getHomePage(): ReturnType<typeof fetchHomePage> {
    return (this.homePromise ??= fetchHomePage());
  }

  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchSearchPage(1, {}).then(parseGenreTags));
  }

  private async getTopRated(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchBrowsePage(page, "rating");
    return {
      items: parseMangaList(document).map(toFeaturedItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async getHomepageRail(title: string): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: parseHomepageRail(await this.getHomePage(), title).map(toSimpleItem),
    };
  }

  private async getLatestUpdates(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchLatestPage(page);
    return {
      items: parseMangaList(document).flatMap((item) => {
        const mapped = toChapterUpdateItem(item);
        return mapped ? [mapped] : [];
      }),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new CocomicAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const searchMetadata = query.metadata ?? {};
    const request: SearchRequest = {
      title: (query.title ?? "").trim() || undefined,
      sortBy: sortingOption?.id ?? SORT_OPTIONS[0].id,
      genres: includedValues(searchMetadata.genres),
      genreMatch: searchMetadata.genreMatch?.[0] === "and" ? "and" : "or",
      author: searchMetadata.author?.trim() || undefined,
      artist: searchMetadata.artist?.trim() || undefined,
      releaseYear: searchMetadata.releaseYear?.trim() || undefined,
      adult: searchMetadata.adult?.[0],
      statuses: searchMetadata.statuses,
    };
    const page = metadata?.page ?? 1;
    const document = await fetchSearchPage(page, request);
    return {
      items: parseMangaList(document).map(toSearchResultItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query.trim().match(/^https?:\/\/(?:www\.)?cocomic\.co\/manga\/[^/?#]+\/?$/i)?.[0];
    const mangaId = parseMangaId(url);
    if (!mangaId) return undefined;
    try {
      const manga = parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
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
    return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchChapterList(sourceManga.mangaId), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(
      await fetchReaderPage(chapter.sourceManga.mangaId, chapter.chapterId),
      chapter,
    );
  }
}

export const Cocomic = new CocomicExtension();
