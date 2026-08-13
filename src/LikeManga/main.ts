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
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import { LikeMangaAdvancedSearchForm } from "./forms";
import {
  PAGE_SIZE,
  SECTIONS,
  SORT_OPTIONS,
  TOP_SERIES_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
  type TriState,
} from "./models";
import {
  fetchChapterListPage,
  fetchAdvancedSearchPage,
  fetchContentPage,
  fetchHomePage,
  fetchHotPage,
  fetchSearchPage,
  LikeMangaInterceptor,
} from "./network";
import {
  contentRatingForGenres,
  encodePathId,
  hasNextPage,
  parseChapterPageInfo,
  parseChapterPages,
  parseChapters,
  parseGenreTags,
  parseMangaDetails,
  parseMangaList,
  parseNewManga,
  toFeaturedItem,
  toHotItem,
  toLatestReleaseItem,
  toNewMangaItem,
  toSearchResultItem,
} from "./parsers";
import type LikeMangaConfig from "./pbconfig";

const pickState = (value: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.entries(value ?? {})
    .filter(([, current]) => current === state)
    .map(([id]) => id);

const normalizedFilterValue = (value: string): string =>
  value
    .replace(/%20/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

const statusFilterId = (status?: string): string => {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("complete")) return "Complete";
  if (normalized.includes("pause") || normalized.includes("hiatus")) return "Pause";
  return "In%20process";
};

class LikeMangaExtension implements ExtensionImpl<typeof LikeMangaConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new LikeMangaInterceptor("main");
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
      {
        id: SECTIONS.MOST_FOLLOWED,
        title: "Most Followed",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.NEW_MANGA,
        title: "New Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.LATEST_RELEASES,
        title: "Latest Releases",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: SECTIONS.TOP_SERIES,
        title: "Top Series",
        type: DiscoverSectionType.genres,
      },
      {
        id: SECTIONS.HOT,
        title: "Hot",
        type: DiscoverSectionType.prominentCarousel,
      },
      {
        id: SECTIONS.GENRES,
        title: "Genres",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.MOST_FOLLOWED:
        return this.getListingSection("follow", metadata, (item) =>
          item.description ? toFeaturedItem(item) : undefined,
        );
      case SECTIONS.NEW_MANGA:
        return { items: parseNewManga(await this.getHomePage()).map(toNewMangaItem) };
      case SECTIONS.LATEST_RELEASES:
        return {
          items: parseMangaList(await this.getHomePage()).flatMap((item) => {
            const mapped = toLatestReleaseItem(item);
            return mapped ? [mapped] : [];
          }),
        };
      case SECTIONS.TOP_SERIES:
        return {
          items: TOP_SERIES_OPTIONS.map(
            (option): DiscoverSectionItem => ({
              type: "genresCarouselItem",
              name: option.title,
              searchQuery: {
                title: "",
                metadata: { topSeriesSort: option.id } satisfies SearchMetadata,
              },
            }),
          ),
        };
      case SECTIONS.HOT:
        return this.getHotSection(metadata);
      case SECTIONS.GENRES:
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  private getHomePage(): ReturnType<typeof fetchHomePage> {
    return (this.homePromise ??= fetchHomePage());
  }

  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchAdvancedSearchPage().then(parseGenreTags));
  }

  private async getListingSection(
    sortBy: string,
    metadata: PageMetadata | undefined,
    mapper: (item: ReturnType<typeof parseMangaList>[number]) => DiscoverSectionItem | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchSearchPage({ page, sortBy });
    return {
      items: parseMangaList(document).flatMap((item) => {
        const mapped = mapper(item);
        return mapped ? [mapped] : [];
      }),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async getHotSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const document = await fetchHotPage(page);
    return {
      items: parseMangaList(document).map(toHotItem),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async getGenreSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: (await this.getGenres()).map(
        (genre): DiscoverSectionItem => ({
          type: "genresCarouselItem",
          name: genre.title,
          searchQuery: {
            title: "",
            metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
          },
          contentRating: contentRatingForGenres([genre.title]),
        }),
      ),
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new LikeMangaAdvancedSearchForm(query, await this.getGenres());
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
    const sortBy = searchMetadata.topSeriesSort ?? sortingOption?.id ?? SORT_OPTIONS[0].id;
    const includedGenres = pickState(searchMetadata.genres, "included");
    const excludedGenres = pickState(searchMetadata.genres, "excluded");
    const includedStatuses = pickState(searchMetadata.status, "included");
    const excludedStatuses = pickState(searchMetadata.status, "excluded");
    const document = await fetchSearchPage({
      page,
      keyword: searchMetadata.keyword?.trim() || (query.title ?? "").trim() || undefined,
      sortBy,
      status:
        includedStatuses.length === 1 && excludedStatuses.length === 0
          ? includedStatuses[0]
          : undefined,
      genres: includedGenres,
      minChapters: searchMetadata.minChapters?.[0],
    });
    const ranked = searchMetadata.topSeriesSort != null;
    // Rank is the row's place in the site's listing, so take it before
    // filtering shifts the surviving rows up.
    const items = parseMangaList(document)
      .map((item, index) => ({ item, rank: (page - 1) * PAGE_SIZE + index + 1 }))
      .filter(({ item }) => {
        const genres = new Set(item.genres.map(normalizedFilterValue));
        if (
          genres.size > 0 &&
          includedGenres.some((genre) => !genres.has(normalizedFilterValue(genre)))
        ) {
          return false;
        }
        if (excludedGenres.some((genre) => genres.has(normalizedFilterValue(genre)))) return false;
        const status = statusFilterId(item.status);
        if (item.status && includedStatuses.length > 0 && !includedStatuses.includes(status)) {
          return false;
        }
        return !item.status || !excludedStatuses.includes(status);
      });

    return {
      items: items.map(({ item, rank }) => toSearchResultItem(item, ranked ? rank : undefined)),
      metadata: hasNextPage(document) ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const path = query
      .trim()
      .match(/^https?:\/\/(?:www\.)?likemanga\.ink\/([^/?#]+-\d+)\/?$/i)?.[1];
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
    const document = await fetchContentPage(sourceManga.mangaId);
    const pageInfo = parseChapterPageInfo(document);
    const fragments =
      pageInfo.mangaNumericId && pageInfo.lastPage > 1
        ? await Promise.all(
            Array.from({ length: pageInfo.lastPage - 1 }, (_, index) =>
              fetchChapterListPage(pageInfo.mangaNumericId!, index + 2),
            ),
          )
        : [];
    return parseChapters(document, fragments, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterPages(await fetchContentPage(chapter.chapterId), chapter);
  }
}

export const LikeManga = new LikeMangaExtension();
