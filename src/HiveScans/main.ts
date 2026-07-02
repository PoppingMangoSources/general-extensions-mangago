/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
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

import { HiveScansAdvancedSearchForm } from "./forms/search";
import { getShowLockedChapters, HiveScansSettingsForm } from "./forms/settings";
import {
  DOMAIN_API,
  PAGE_SIZE,
  type HiveScansGenre,
  type HiveScansPostDetailsResponse,
  type HiveScansChapterResponse,
  type HiveScansSearchResponse,
  type Metadata,
  type OptionItem,
  type SearchMetadata,
} from "./models";
import { fetchJSON, HiveScansInterceptor } from "./network";
import {
  decodeMangaId,
  encodeMangaId,
  genresToOptions,
  normalizeSearchTerm,
  parseChapterDetails,
  parseChapterList,
  parseMangaDetails,
  parseSearchResults,
  toFeaturedItems,
  toSimpleItems,
} from "./parsers";
import type HiveScansConfig from "./pbconfig";

const SECTION_POPULAR = "popular";
const SECTION_LATEST = "latest";
const SECTION_GENRES = "genres";

const GENRES_CACHE_TTL = 60 * 60 * 1000;

const SORTING_OPTIONS: SortingOption[] = [
  { id: "lastChapterAddedAt", label: "Last Chapter" },
  { id: "totalViews", label: "Views" },
  { id: "createdAt", label: "Added Date" },
  { id: "chaptersCount", label: "Chapters Count" },
  { id: "postTitle", label: "Alphabetical" },
];

export class HiveScansExtension implements ExtensionImpl<typeof HiveScansConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  hiveScansInterceptor = new HiveScansInterceptor("main");

  private genresCache: { options: OptionItem[]; timestamp: number } | null = null;

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.hiveScansInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new HiveScansSettingsForm();
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
  }

  // ----------------------------------------------------------------
  // Discover
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_GENRES) {
      const genres = await this.getGenres();
      const items: DiscoverSectionItem[] = genres.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.value,
        searchQuery: {
          title: "",
          metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const orderBy = section.id === SECTION_POPULAR ? "totalViews" : "lastChapterAddedAt";
    const url = new URL(DOMAIN_API)
      .addPathComponent("query")
      .setQueryItem("page", page.toString())
      .setQueryItem("perPage", PAGE_SIZE.toString())
      .setQueryItem("searchTerm", "")
      .setQueryItem("orderBy", orderBy)
      .toString();

    const data = await fetchJSON<HiveScansSearchResponse>({ url, method: "GET" });
    const items =
      section.id === SECTION_POPULAR
        ? toFeaturedItems(data.posts ?? [])
        : toSimpleItems(data.posts ?? []);

    const hasNextPage = data.totalCount > page * PAGE_SIZE;
    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new HiveScansAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    // Let users paste a series link into search to open it directly.
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const searchTerm = normalizeSearchTerm(query.title ?? "");

    const builder = new URL(DOMAIN_API)
      .addPathComponent("query")
      .setQueryItem("page", page.toString())
      .setQueryItem("perPage", PAGE_SIZE.toString())
      .setQueryItem("searchTerm", searchTerm);

    if (sortingOption?.id) builder.setQueryItem("orderBy", sortingOption.id);

    const meta = query.metadata;
    if (meta?.status?.[0]) builder.setQueryItem("seriesStatus", meta.status[0]);
    if (meta?.type?.[0]) builder.setQueryItem("seriesType", meta.type[0]);
    if (meta?.direction?.[0]) builder.setQueryItem("orderDirection", meta.direction[0]);

    const genres = Object.entries(meta?.genres ?? {});
    const includeIds = genres.filter(([, state]) => state === "included").map(([id]) => id);
    const excludeIds = genres.filter(([, state]) => state === "excluded").map(([id]) => id);
    if (includeIds.length > 0) builder.setQueryItem("genreIds", includeIds.join(","));
    if (excludeIds.length > 0) builder.setQueryItem("excludeGenreIds", excludeIds.join(","));

    const data = await fetchJSON<HiveScansSearchResponse>({
      url: builder.toString(),
      method: "GET",
    });

    const items = parseSearchResults(data.posts ?? []);
    const hasNextPage = data.totalCount > page * PAGE_SIZE;

    return { items, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  // Resolves a pasted `hivetoons.org/series/<slug>` link to a single result.
  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const match = query.trim().match(/^https?:\/\/[^/]*hivetoons\.org\/series\/([^/?#]+)/i);
    if (!match) return undefined;

    try {
      const manga = await this.getMangaDetails(encodeMangaId(decodeURIComponent(match[1])));
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
    } catch {
      return undefined;
    }
  }

  // ----------------------------------------------------------------
  // Manga details & chapters
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const data = await this.fetchPost(mangaId);
    return parseMangaDetails(data.post);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const data = await this.fetchPost(sourceManga.mangaId);
    return parseChapterList(data.post.chapters ?? [], sourceManga, getShowLockedChapters());
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URL(DOMAIN_API)
      .addPathComponent("chapter")
      .setQueryItem("chapterId", chapter.chapterId)
      .toString();

    const data = await fetchJSON<HiveScansChapterResponse>({ url, method: "GET" });
    if (!data.chapter) {
      throw new Error(`No chapter data returned for chapter ${chapter.chapterId}`);
    }
    return parseChapterDetails(data.chapter, chapter);
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private async fetchPost(mangaId: string): Promise<HiveScansPostDetailsResponse> {
    const slug = decodeMangaId(mangaId);
    const url = new URL(DOMAIN_API)
      .addPathComponent("post")
      .setQueryItem("postSlug", slug)
      .toString();
    return fetchJSON<HiveScansPostDetailsResponse>({ url, method: "GET" });
  }

  private async getGenres(): Promise<OptionItem[]> {
    if (this.genresCache && Date.now() - this.genresCache.timestamp < GENRES_CACHE_TTL) {
      return this.genresCache.options;
    }

    try {
      const url = new URL(DOMAIN_API).addPathComponent("genres").toString();
      const genres = await fetchJSON<HiveScansGenre[]>({ url, method: "GET" });
      const options = genresToOptions(genres);
      this.genresCache = { options, timestamp: Date.now() };
      return options;
    } catch {
      // Genres are optional; a failure shouldn't break the search form.
      return this.genresCache?.options ?? [];
    }
  }
}

export const HiveScans = new HiveScansExtension();
