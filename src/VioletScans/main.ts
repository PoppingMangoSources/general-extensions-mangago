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
  type Response,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import { VioletScansAdvancedSearchForm } from "./forms/search";
import { getShowLockedChapters, VioletScansSettingsForm } from "./forms/settings";
import {
  DOMAIN,
  SECTIONS,
  SORTING_OPTIONS,
  type ChapterUpdateKind,
  type GenreOption,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchCatalogPage,
  fetchChapterPage,
  fetchChapterUpdatesPage,
  fetchDocument,
  fetchMangaPage,
  VioletScansInterceptor,
} from "./network";
import {
  contentRatingForGenres,
  hasNextPage,
  parseChapterDetails,
  parseChapters,
  parseChapterUpdatePageMetadata,
  parseGenreOptions,
  parseHomeAnchor,
  parseLockedChapter,
  parseMangaList,
  parseMangaDetails,
  parseMangaId,
} from "./parsers";
import type VioletScansConfig from "./pbconfig";

class VioletScansExtension implements ExtensionImpl<typeof VioletScansConfig> {
  globalRateLimiter = new BasicRateLimiter("violetscans_rate_limiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  mainInterceptor = new VioletScansInterceptor("violetscans");

  private homePromise?: Promise<CheerioAPI>;
  private catalogPromise?: Promise<CheerioAPI>;
  private genresPromise?: Promise<GenreOption[]>;

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
    Application.setRedirectHandler(
      Application.Selector(this as VioletScansExtension, "handleRedirect"),
    );
  }

  async handleRedirect(request: Request, _response: Response): Promise<Request> {
    return this.mainInterceptor.interceptRequest(request);
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.homePromise = undefined;
    this.catalogPromise = undefined;
    this.genresPromise = undefined;
    for (const cookie of cookies) {
      if (!cookie.expires || cookie.expires.getTime() > Date.now()) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: SECTIONS.MOST_POPULAR,
        title: "Most Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.POPULAR_TODAY,
        title: "Popular Today",
        type: DiscoverSectionType.prominentCarousel,
      },
      { id: SECTIONS.NEW_SERIES, title: "New Series", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.LATEST_COMICS,
        title: "Latest Comics",
        type: DiscoverSectionType.chapterUpdates,
      },
      { id: SECTIONS.EDITOR_PICKS, title: "Editor Picks", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.LATEST_NOVELS,
        title: "Latest Novels",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: SECTIONS.LATEST_MANGA,
        title: "Latest Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.COMPLETED,
        title: "Completed Series",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.MOST_POPULAR:
        return this.getMostPopularSection(metadata?.page ?? 1);
      case SECTIONS.POPULAR_TODAY:
        return this.getPopularTodaySection();
      case SECTIONS.NEW_SERIES:
        return this.getNewSeriesSection();
      case SECTIONS.LATEST_COMICS:
        return this.getChapterUpdatesSection("comics", metadata);
      case SECTIONS.EDITOR_PICKS:
        return this.getEditorPicksSection();
      case SECTIONS.LATEST_NOVELS:
        return this.getChapterUpdatesSection("novels", metadata);
      case SECTIONS.LATEST_MANGA:
        return this.getLatestMangaSection();
      case SECTIONS.FEATURED:
        return this.getFeaturedSection();
      case SECTIONS.COMPLETED:
        return this.getCompletedSection();
      case SECTIONS.GENRES:
        return this.getGenresSection();
      default:
        return { items: [], metadata: undefined };
    }
  }

  private async getMostPopularSection(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    const $ =
      page === 1
        ? await this.getCatalogPageOne()
        : await fetchCatalogPage({ page, order: "popular" });
    const items: DiscoverSectionItem[] = parseMangaList($, {
      selector: ".listupd .bsx",
    }).map((card) => {
      const infoItems: { symbol: string; text: string }[] = [];
      if (card.rating != null) {
        infoItems.push({ symbol: "star.fill", text: card.rating.toFixed(1) });
      }
      if (card.status) infoItems.push({ symbol: "book.closed", text: card.status });
      return {
        type: "featuredCarouselItem",
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        infoItems:
          infoItems.length === 0
            ? undefined
            : infoItems.length === 1
              ? [infoItems[0]]
              : [infoItems[0], infoItems[1]],
        contentRating: contentRatingForGenres(card.genres ?? []),
      };
    });
    return { items, metadata: hasNextPage($) ? { page: page + 1 } : undefined };
  }

  private async getPopularTodaySection(): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = parseMangaList(await this.getHomePage(), {
      selector: ".violet-popular-today-section .bsx",
    }).map((card) => ({
      type: "prominentCarouselItem",
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle:
        [card.rating != null ? `★ ${card.rating.toFixed(1)}` : undefined, card.status]
          .filter((value): value is string => Boolean(value))
          .join(" • ") || undefined,
      contentRating: contentRatingForGenres(card.genres ?? []),
    }));
    return { items, metadata: undefined };
  }

  private async getNewSeriesSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = parseMangaList(await this.getHomePage(), {
      selector: "[data-violet-section='new-series'] .bsx",
    }).map((card) => ({
      type: "simpleCarouselItem",
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle: card.rating != null ? `★ ${card.rating.toFixed(1)}` : undefined,
      contentRating: contentRatingForGenres(card.genres ?? []),
    }));
    return { items, metadata: undefined };
  }

  private async getChapterUpdatesSection(
    kind: ChapterUpdateKind,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const isFirstPage = page === 1;
    const initialOrganicCount = metadata?.initialOrganicCount;
    const displayedPinIds = metadata?.displayedPinIds ?? "";
    const anchorTimestamp = metadata?.anchorTimestamp;
    let $: CheerioAPI;
    if (isFirstPage) {
      $ = await this.getHomePage();
    } else {
      if (initialOrganicCount == null) return { items: [], metadata: undefined };
      $ = await fetchChapterUpdatesPage(kind, page, initialOrganicCount, displayedPinIds);
    }
    const selector = isFirstPage
      ? kind === "comics"
        ? ".violet-latest-comics .violet-card-shell"
        : ".violet-latest-novels .violet-card-shell"
      : ".violet-card-shell";
    const anchor = isFirstPage
      ? parseHomeAnchor($)
      : anchorTimestamp != null
        ? new Date(anchorTimestamp)
        : undefined;
    const cards = parseMangaList($, {
      selector,
      kind: "chapterUpdates",
      showLocked: getShowLockedChapters(),
      anchor,
    });
    const items: DiscoverSectionItem[] = cards.flatMap((card) =>
      card.chapterId && card.chapterName
        ? [
            {
              type: "chapterUpdatesCarouselItem",
              mangaId: card.mangaId,
              chapterId: card.chapterId,
              title: card.title,
              imageUrl: card.imageUrl,
              subtitle:
                [
                  card.isLocked ? `${card.chapterName} 🔒` : card.chapterName,
                  card.rating != null ? `★ ${card.rating.toFixed(1)}` : undefined,
                ]
                  .filter((value): value is string => Boolean(value))
                  .join(" • ") || undefined,
              publishDate: card.publishDate,
              contentRating: contentRatingForGenres(card.genres ?? []),
            },
          ]
        : [],
    );

    const nextMetadata = isFirstPage
      ? parseChapterUpdatePageMetadata(
          $,
          kind === "comics" ? "#load-more" : "#violet-load-more-novels",
          anchor,
        )
      : initialOrganicCount != null && $(selector).length >= initialOrganicCount
        ? { page: page + 1, initialOrganicCount, displayedPinIds, anchorTimestamp }
        : undefined;
    return { items, metadata: nextMetadata };
  }

  private async getEditorPicksSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = parseMangaList(await this.getHomePage(), {
      selector: ".violet-editor-picks .violet-ep-panel",
      kind: "editorPicks",
    }).map((card) => ({
      type: "featuredCarouselItem",
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      summary: card.genres?.join(" • ") || undefined,
      infoItems: card.status ? [{ symbol: "book.closed", text: card.status }] : undefined,
      contentRating: contentRatingForGenres(card.genres ?? []),
    }));
    return { items, metadata: undefined };
  }

  private async getLatestMangaSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = parseMangaList(await this.getHomePage(), {
      selector: "[data-violet-section='latest-manga'] .bsx",
    }).map((card) => ({
      type: "simpleCarouselItem",
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle:
        [card.chapterName, card.rating != null ? `★ ${card.rating.toFixed(1)}` : undefined]
          .filter((value): value is string => Boolean(value))
          .join(" • ") || undefined,
      contentRating: contentRatingForGenres(card.genres ?? []),
    }));
    return { items, metadata: undefined };
  }

  private async getFeaturedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = parseMangaList(await this.getHomePage(), {
      selector: ".slidernew .swiper-slide",
      kind: "featured",
    }).map((card) => ({
      type: "featuredCarouselItem",
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      contentRating: contentRatingForGenres(card.genres ?? []),
    }));
    return { items, metadata: undefined };
  }

  private async getCompletedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = parseMangaList(await this.getHomePage(), {
      selector: "[data-violet-section='completed-series'] .bsx",
    }).map((card) => ({
      type: "simpleCarouselItem",
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle: card.rating != null ? `★ ${card.rating.toFixed(1)}` : undefined,
      contentRating: contentRatingForGenres(card.genres ?? []),
    }));
    return { items, metadata: undefined };
  }

  private async getGenresSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const items: DiscoverSectionItem[] = (await this.getGenres()).map((genre) => ({
      type: "genresCarouselItem",
      name: genre.title,
      searchQuery: {
        title: "",
        metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
      },
      contentRating: contentRatingForGenres([genre.title]),
    }));
    return { items, metadata: undefined };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new VioletScansAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = query.title.trim();
    const pastedResult = await this.resolveUrlQuery(title);
    if (pastedResult) return pastedResult;

    const searchMetadata = query.metadata ?? { genres: {}, status: [], type: [] };
    const selectedGenres = Object.entries(searchMetadata.genres ?? {})
      .filter(([, state]) => state === "included")
      .map(([id]) => id);
    const genreOptions = selectedGenres.length > 0 ? await this.getGenres() : [];
    const genreValues = selectedGenres.flatMap((id) => {
      const option = genreOptions.find((genre) => genre.id === id);
      return option ? [option.value] : [];
    });

    const page = metadata?.page ?? 1;
    const $ = await fetchCatalogPage({
      page,
      ...(title && { title }),
      ...(genreValues.length > 0 && { genres: genreValues }),
      ...(searchMetadata.status?.[0] && { status: searchMetadata.status[0] }),
      ...(searchMetadata.type?.[0] && { type: searchMetadata.type[0] }),
      ...(sortingOption?.id && { order: sortingOption.id }),
    });
    const items: SearchResultItem[] = parseMangaList($, { selector: ".listupd .bsx" }).map(
      (card) => ({
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        subtitle:
          [
            card.isNovel ? "Novel" : undefined,
            card.status,
            card.rating != null ? `★ ${card.rating.toFixed(1)}` : undefined,
          ]
            .filter((value): value is string => Boolean(value))
            .join(" • ") || undefined,
        contentRating: contentRatingForGenres(card.genres ?? []),
      }),
    );
    return { items, metadata: hasNextPage($) ? { page: page + 1 } : undefined };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    if (!/^https?:\/\//i.test(query)) return undefined;
    if (!/^https?:\/\/(?:www\.)?violetscans\.org\/comics\/[^/?#]+\/?(?:[?#].*)?$/i.test(query)) {
      return undefined;
    }
    const mangaId = parseMangaId(query);
    if (!mangaId) return undefined;
    try {
      const manga = await this.getMangaDetails(mangaId);
      return {
        items: [
          {
            mangaId,
            title: manga.mangaInfo.primaryTitle,
            imageUrl: manga.mangaInfo.thumbnailUrl,
            subtitle: manga.mangaInfo.status,
            contentRating: manga.mangaInfo.contentRating,
          },
        ],
        metadata: undefined,
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
    return parseChapters(
      await fetchMangaPage(sourceManga.mangaId),
      sourceManga,
      getShowLockedChapters(),
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const locked = parseLockedChapter(chapter.chapterId);
    if (locked) {
      throw new Error(
        `Chapter ${locked.chapterNumber || chapter.chapNum} is locked${locked.price && locked.price !== "0" ? ` and costs ${locked.price} coins` : ""}.`,
      );
    }
    return parseChapterDetails(await fetchChapterPage(chapter.chapterId), chapter);
  }

  async getSettingsForm(): Promise<Form> {
    return new VioletScansSettingsForm();
  }

  private async getHomePage(): Promise<CheerioAPI> {
    const request = (this.homePromise ??= fetchDocument(`${DOMAIN}/`));
    try {
      return await request;
    } finally {
      if (this.homePromise === request) this.homePromise = undefined;
    }
  }

  private async getCatalogPageOne(): Promise<CheerioAPI> {
    const request = (this.catalogPromise ??= fetchCatalogPage({ order: "popular" }));
    try {
      return await request;
    } finally {
      if (this.catalogPromise === request) this.catalogPromise = undefined;
    }
  }

  private async getGenres(): Promise<GenreOption[]> {
    const request = (this.genresPromise ??= this.getCatalogPageOne().then(parseGenreOptions));
    try {
      return await request;
    } catch (error: unknown) {
      if (this.genresPromise === request) this.genresPromise = undefined;
      throw error;
    }
  }
}

export const VioletScans = new VioletScansExtension();
