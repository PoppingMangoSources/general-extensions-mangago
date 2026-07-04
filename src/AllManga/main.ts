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
  type FeaturedCarouselItem,
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
  LATEST_QUERY,
  LIMIT,
  PAGES_QUERY,
  POPULAR_QUERY,
  RANDOM_QUERY,
  SEARCH_QUERY,
  SORT_OPTIONS,
  type ChaptersData,
  type DetailsData,
  type MangaCard,
  type PageMetadata,
  type PagesData,
  type PopularData,
  type RandomData,
  type SearchData,
  type SearchMetadata,
} from "./models";
import { AllMangaInterceptor, getGraphQL, postGraphQL } from "./network";
import {
  dateFromParts,
  formatCount,
  parseChapters,
  parseMangaDetails,
  parsePageUrls,
  parseThumbnailUrl,
  toSearchResultItem,
} from "./parsers";
import type AllMangaConfig from "./pbconfig";
import { pageListViaWebView } from "./utils/webView";

const SECTION_POPULAR = "popular";
const SECTION_POPULAR_WEEK = "popular_week";
const SECTION_POPULAR_MONTH = "popular_month";
const SECTION_LATEST = "latest";
const SECTION_RECOMMENDED = "recommended";
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
      {
        id: SECTION_POPULAR_WEEK,
        title: "Popular This Week",
        type: DiscoverSectionType.prominentCarousel,
      },
      {
        id: SECTION_POPULAR_MONTH,
        title: "Popular This Month",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION_RECOMMENDED, title: "Recommended", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  // Popular sections all hit queryPopular with a different dateRange window
  // (0 all-time, 7 week, 30 month) and map each card to the section's item type.
  private async popularSection(
    page: number,
    dateRange: number,
    toItem: (card: MangaCard, views: string | null | undefined) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const data = await postGraphQL<PopularData>(POPULAR_QUERY, {
      type: "manga",
      size: LIMIT,
      dateRange,
      page,
      allowAdult: getShowAdult(),
      allowUnknown: false,
    });
    const recommendations = data.queryPopular.recommendations;
    const items = recommendations
      .filter((rec) => rec.anyCard != null)
      .map((rec) => toItem(rec.anyCard!, rec.pageStatus?.views));
    // Base pagination on the raw page size, not the filtered item count.
    const hasNext = recommendations.length === LIMIT;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
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

    if (section.id === SECTION_RECOMMENDED) {
      let cards: MangaCard[] = [];
      try {
        const data = await postGraphQL<RandomData>(RANDOM_QUERY, {
          format: "manga",
          allowAdult: getShowAdult(),
        });
        cards = data.queryRandomRecommendation ?? [];
      } catch {
        // Recommendations are best-effort; render nothing rather than error.
      }
      const items: DiscoverSectionItem[] = cards.map((card) => ({
        type: "simpleCarouselItem",
        mangaId: card._id,
        title: Application.decodeHTMLEntities(card.englishName || card.name),
        imageUrl: parseThumbnailUrl(card.thumbnail),
        contentRating,
      }));
      return { items, metadata: undefined };
    }

    const page = metadata?.page ?? 1;

    // Popular ranges share one query; dateRange 0/7/30 = all-time/week/month.
    if (section.id === SECTION_POPULAR) {
      return this.popularSection(page, 0, (card, views) => {
        const infoItems: NonNullable<FeaturedCarouselItem["infoItems"]> = [];
        if (card.score != null) {
          infoItems.push({ symbol: "star.fill", text: card.score.toFixed(1) });
        }
        if (views) {
          infoItems.push({ symbol: "flame.fill", text: formatCount(views) });
        }
        const chapters = card.availableChapters?.sub;
        return {
          type: "featuredCarouselItem",
          mangaId: card._id,
          title: Application.decodeHTMLEntities(card.englishName || card.name),
          imageUrl: parseThumbnailUrl(card.thumbnail),
          supertitle: chapters != null ? `${chapters} Chapters` : undefined,
          infoItems,
          contentRating,
        };
      });
    }

    if (section.id === SECTION_POPULAR_WEEK) {
      return this.popularSection(page, 7, (card) => ({
        type: "prominentCarouselItem",
        mangaId: card._id,
        title: Application.decodeHTMLEntities(card.englishName || card.name),
        imageUrl: parseThumbnailUrl(card.thumbnail),
        subtitle: card.score != null ? `★ ${card.score.toFixed(1)}` : undefined,
        contentRating,
      }));
    }

    if (section.id === SECTION_POPULAR_MONTH) {
      return this.popularSection(page, 30, (card) => ({
        type: "simpleCarouselItem",
        mangaId: card._id,
        title: Application.decodeHTMLEntities(card.englishName || card.name),
        imageUrl: parseThumbnailUrl(card.thumbnail),
        subtitle: card.score != null ? `★ ${card.score.toFixed(1)}` : undefined,
        contentRating,
      }));
    }

    // Latest updates — newest chapters first, rendered as chapter-update cards.
    // Fall back to a plain carousel if the richer query shape is ever rejected.
    try {
      const latest = await postGraphQL<SearchData>(LATEST_QUERY, {
        search: {
          query: null,
          sortBy: null,
          genres: null,
          excludeGenres: null,
          isManga: true,
          allowAdult: getShowAdult(),
          allowUnknown: false,
        },
        size: LIMIT,
        page,
        translationType: "sub",
        countryOrigin: "ALL",
      });
      const items: DiscoverSectionItem[] = latest.mangas.edges.map((card) => {
        const chapters = card.availableChapters?.sub;
        return {
          type: "chapterUpdatesCarouselItem",
          mangaId: card._id,
          chapterId: chapters != null ? String(chapters) : "",
          title: Application.decodeHTMLEntities(card.englishName || card.name),
          imageUrl: parseThumbnailUrl(card.thumbnail),
          subtitle: chapters != null ? `Chapter ${chapters}` : "",
          publishDate: dateFromParts(card.lastChapterDate?.sub),
          contentRating,
        };
      });
      const hasNext = latest.mangas.edges.length === LIMIT;
      return { items, metadata: hasNext ? { page: page + 1 } : undefined };
    } catch {
      // Fall through to the minimal query below (same card shape, no chapter).
    }

    const data = await this.runSearch("", undefined, undefined, page);
    const items: DiscoverSectionItem[] = data.mangas.edges.map((card) => ({
      type: "chapterUpdatesCarouselItem",
      mangaId: card._id,
      chapterId: "",
      title: Application.decodeHTMLEntities(card.englishName || card.name),
      imageUrl: parseThumbnailUrl(card.thumbnail),
      subtitle: "",
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
    const items = data.mangas.edges.map((card) => toSearchResultItem(card, contentRating));
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
    return parseMangaDetails(mangaId, data.manga);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaId = sourceManga.mangaId;
    const data = await postGraphQL<ChaptersData>(CHAPTERS_QUERY, {
      id: mangaId,
      showId: `manga@${mangaId}`,
    });
    return parseChapters(sourceManga, data);
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
      pages = parsePageUrls(await getGraphQL<PagesData>(PAGES_QUERY, variables), quality);
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
        if (data) pages = parsePageUrls(data, quality);
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