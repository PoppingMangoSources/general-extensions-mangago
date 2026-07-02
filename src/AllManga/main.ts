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

import {
  AllMangaAdvancedSearchForm,
  AllMangaSettingsForm,
  contentRatingForAdult,
  getImageQuality,
  getShowAdult,
} from "./forms";
import {
  CHAPTERS_QUERY,
  DETAILS_QUERY,
  genreId,
  GENRE_NAME_BY_ID,
  GENRE_OPTIONS,
  LIMIT,
  PAGES_QUERY,
  POPULAR_QUERY,
  SEARCH_QUERY,
  SORT_OPTIONS,
  type ChaptersData,
  type DetailsData,
  type PageMetadata,
  type PagesData,
  type PopularData,
  type SearchData,
  type SearchMetadata,
} from "./models";
import { AllMangaInterceptor, getGraphQL, postGraphQL } from "./network";
import {
  buildChapters,
  cardToSearchResult,
  detailToSourceManga,
  parseThumbnailUrl,
  resolvePageUrls,
} from "./parsers";
import type AllMangaConfig from "./pbconfig";
import { pageListViaWebView } from "./webView";

const SECTION_POPULAR = "popular";
const SECTION_LATEST = "latest";
const SECTION_GENRES = "genres";

const SORTING_OPTIONS: SortingOption[] = SORT_OPTIONS.map((option) => ({
  id: option.id,
  label: option.value,
}));

export class AllMangaExtension implements ExtensionImpl<typeof AllMangaConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  allMangaInterceptor = new AllMangaInterceptor("main");

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.allMangaInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new AllMangaSettingsForm();
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
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const contentRating = contentRatingForAdult();

    if (section.id === SECTION_GENRES) {
      const items: DiscoverSectionItem[] = GENRE_OPTIONS.map((genre) => ({
        type: "genresCarouselItem",
        name: genre,
        searchQuery: {
          title: "",
          metadata: { genres: { [genreId(genre)]: "included" } } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const page = metadata?.page ?? 1;

    if (section.id === SECTION_POPULAR) {
      const data = await postGraphQL<PopularData>(POPULAR_QUERY, {
        type: "manga",
        size: LIMIT,
        dateRange: 0,
        page,
        allowAdult: getShowAdult(),
        allowUnknown: false,
      });
      const recommendations = data.queryPopular.recommendations;
      const items: DiscoverSectionItem[] = recommendations
        .map((rec) => rec.anyCard)
        .filter((card): card is NonNullable<typeof card> => card != null)
        .map((card) => ({
          type: "featuredCarouselItem",
          mangaId: card._id,
          title: Application.decodeHTMLEntities(card.englishName || card.name),
          imageUrl: parseThumbnailUrl(card.thumbnail),
          contentRating,
        }));
      // Base pagination on the raw page size, not the filtered item count.
      const hasNext = recommendations.length === LIMIT;
      return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    }

    // Latest updates — search with no query and default (update) ordering.
    const data = await this.runSearch("", undefined, undefined, page);
    const items: DiscoverSectionItem[] = data.mangas.edges.map((card) => ({
      type: "simpleCarouselItem",
      mangaId: card._id,
      title: Application.decodeHTMLEntities(card.englishName || card.name),
      imageUrl: parseThumbnailUrl(card.thumbnail),
      contentRating,
    }));
    const hasNext = data.mangas.edges.length === LIMIT;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new AllMangaAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title ?? "").trim();

    // Let users paste a manga link (allmanga.to or the mkissa.to mirror) or an
    // `id:<id>` reference into search to open it directly.
    const pasted = await this.resolveDirectQuery(title);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const data = await this.runSearch(title, query.metadata, sortingOption?.id, page);

    const contentRating = contentRatingForAdult();
    const items = data.mangas.edges.map((card) => cardToSearchResult(card, contentRating));
    const hasNext = data.mangas.edges.length === LIMIT;

    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  private async resolveDirectQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    let id: string | undefined;
    const urlMatch = query.match(/^https?:\/\/[^/]*(?:allmanga\.to|mkissa\.to)\/manga\/([^/?#]+)/i);
    if (urlMatch) {
      id = decodeURIComponent(urlMatch[1]);
    } else if (query.toLowerCase().startsWith("id:")) {
      id = query.slice(3).trim();
    }
    if (!id) return undefined;

    try {
      const manga = await this.getMangaDetails(id);
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

  private async runSearch(
    title: string,
    meta: SearchMetadata | undefined,
    sortId: string | undefined,
    page: number,
  ): Promise<SearchData> {
    // Tag ids are space-free (e.g. "4_Koma"); the API filters on the display
    // name ("4 Koma"), so map ids back before sending.
    const included = Object.entries(meta?.genres ?? {})
      .filter(([, state]) => state === "included")
      .map(([id]) => GENRE_NAME_BY_ID[id] ?? id);
    const excluded = Object.entries(meta?.genres ?? {})
      .filter(([, state]) => state === "excluded")
      .map(([id]) => GENRE_NAME_BY_ID[id] ?? id);

    return postGraphQL<SearchData>(SEARCH_QUERY, {
      search: {
        query: title.length > 0 ? title : null,
        sortBy: sortId ? sortId : null,
        genres: included.length > 0 ? included : null,
        excludeGenres: excluded.length > 0 ? excluded : null,
        isManga: true,
        allowAdult: getShowAdult(),
        allowUnknown: false,
      },
      size: LIMIT,
      page,
      translationType: "sub",
      countryOrigin: meta?.country?.[0] ?? "ALL",
    });
  }

  // ----------------------------------------------------------------
  // Details & chapters
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const data = await postGraphQL<DetailsData>(DETAILS_QUERY, { id: mangaId });
    return detailToSourceManga(mangaId, data.manga, contentRatingForAdult());
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const data = await postGraphQL<ChaptersData>(CHAPTERS_QUERY, {
      id: mangaId,
      showId: `manga@${mangaId}`,
    });
    return buildChapters(sourceManga, data);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const quality = getImageQuality();
    const variables = {
      mangaId,
      translationType: "sub",
      chapterString: chapter.chapterId,
    };

    // Fast path: the direct `chapterPages` query served over GET. A Cloudflare
    // challenge must bubble up so the app can run the bypass; any other failure
    // (e.g. a transient 502) falls through to the WebView below.
    let pages: string[] = [];
    try {
      pages = resolvePageUrls(await getGraphQL<PagesData>(PAGES_QUERY, variables), quality);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }

    // Fallback: load the reader in a WebView and capture the pages payload the
    // site parses itself. This mirrors the reader's own flow, so it keeps
    // working if the direct query is ever gated.
    if (pages.length === 0) {
      try {
        const data = await pageListViaWebView(
          mangaId,
          chapter.chapterId,
          this.cookieStorageInterceptor,
        );
        if (data) pages = resolvePageUrls(data, quality);
      } catch {
        // Fall through to the error below.
      }
    }

    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}.`);
    }

    return {
      id: chapter.chapterId,
      mangaId,
      pages,
    };
  }
}

export const AllManga = new AllMangaExtension();
