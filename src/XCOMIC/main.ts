/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
  CookieStorageInterceptor,
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
  type Tag,
} from "@paperback/types";

import { XComicAdvancedSearchForm } from "./forms/search";
import {
  XComicSettingsForm,
  getPreferences,
  getSectionOrder,
  getVisibleSections,
} from "./forms/settings";
import {
  DISCOVER_SECTIONS,
  MOST_VIEWS_OPTIONS,
  PAGE_SIZE,
  SECTIONS,
  SORTING_OPTIONS,
  STATE_KEYS,
  type BrowseSelect,
  type ComicNode,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchBrowse,
  fetchChapterPages,
  fetchChapters,
  fetchComic,
  fetchLatestUploads,
  fetchLatestUpdates,
  fetchRecentlyAdded,
  fetchSearchPage,
  XComicInterceptor,
} from "./network";
import {
  parseChapterDetails,
  parseGenreOptions,
  parseLatestUploads,
  parseRecentlyAdded,
  toChapter,
  toDiscoverItem,
  toSearchResultItem,
  toSourceManga,
  type CarouselItemType,
} from "./parsers";
import type XComicConfig from "./pbconfig";

const MAX_EMPTY_BROWSE_PAGES = 10;

const sameValues = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

const isMostViewsSort = (id: string): boolean =>
  MOST_VIEWS_OPTIONS.some((option) => option.id === id);

class XComicExtension implements ExtensionImpl<typeof XComicConfig> {
  private genresPromise?: Promise<Tag[]>;
  private rateLimiter = new BasicRateLimiter("xcomic-rate-limiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new XComicInterceptor("xcomic-interceptor");

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
      this.cookieStorageInterceptor.setCookie(cookie);
    }
    this.genresPromise = undefined;
    Application.invalidateDiscoverSections();
  }

  async getSettingsForm(): Promise<Form> {
    return new XComicSettingsForm(
      getPreferences(),
      getSectionOrder(),
      getVisibleSections(),
      await this.getGenres(),
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const visible = new Set(getVisibleSections());
    return getSectionOrder()
      .filter((id) => visible.has(id))
      .map((id) => DISCOVER_SECTIONS[id]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.TOP_RATED:
        return this.getBrowseSection(metadata, "field_score", "featuredCarouselItem");
      case SECTIONS.LATEST_UPLOADS:
        return this.getLatestUploadsSection(metadata);
      case SECTIONS.RECENTLY_ADDED:
        return this.getRecentlyAddedSection(metadata);
      case SECTIONS.MOST_CHAPTERS:
        return this.getBrowseSection(metadata, "field_chapter", "simpleCarouselItem");
      case SECTIONS.MOST_VIEWS:
        return this.getMostViewsSection();
      case SECTIONS.GENRES:
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  private async getLatestUploadsSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const result = parseLatestUploads(await fetchLatestUploads(metadata?.before));
    return {
      items: result.items,
      metadata: result.before != null ? { before: result.before } : undefined,
    };
  }

  private async getRecentlyAddedSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const result = parseRecentlyAdded(await fetchRecentlyAdded(), metadata?.page ?? 1);
    return {
      items: result.items.map((item) => ({ type: "simpleCarouselItem", ...item })),
      metadata: result.nextPage != null ? { page: result.nextPage } : undefined,
    };
  }

  private async getBrowseSection(
    metadata: PageMetadata | undefined,
    sortby: string,
    itemType: CarouselItemType,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const result = await this.getUsableBrowsePage(page, sortby, "", undefined);
    return {
      items: result.nodes
        .map((node) => toDiscoverItem(node, itemType))
        .filter((item): item is DiscoverSectionItem => item !== undefined),
      metadata: result.nextPage != null ? { page: result.nextPage } : undefined,
    };
  }

  private async getGenreSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: (await this.getGenres()).map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
        },
      })),
    };
  }

  private getMostViewsSection(): PagedResults<DiscoverSectionItem> {
    return {
      items: MOST_VIEWS_OPTIONS.map((option) => ({
        type: "genresCarouselItem",
        name: option.chipLabel,
        searchQuery: {
          title: "",
          metadata: { discoverSort: option.id } satisfies SearchMetadata,
        },
      })),
    };
  }

  private async getGenres(): Promise<Tag[]> {
    const stored = Application.getState(STATE_KEYS.GENRES) as Tag[] | undefined;
    if (stored?.length) return stored;
    const genres = await (this.genresPromise ??= fetchSearchPage().then(parseGenreOptions));
    Application.setState(genres, STATE_KEYS.GENRES);
    return genres;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new XComicAdvancedSearchForm(query, getPreferences(), await this.getGenres());
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const sortby = query.metadata?.discoverSort ?? sortingOption?.id ?? "field_score";

    if (sortby === "field_update" && this.canUseUnfilteredFeed(query)) {
      return this.getLatestSearchResults(metadata);
    }

    if (sortby === "field_create" && this.canUseUnfilteredFeed(query)) {
      return this.getRecentlyAddedSearchResults(metadata);
    }

    const page = metadata?.page ?? 1;
    const result = await this.getUsableBrowsePage(
      page,
      sortby,
      (query.title ?? "").trim(),
      query.metadata,
      isMostViewsSort(sortby) && this.canUseUnfilteredFeed(query),
    );
    return {
      items: result.nodes.map(toSearchResultItem),
      metadata: result.nextPage != null ? { page: result.nextPage } : undefined,
    };
  }

  private async getUsableBrowsePage(
    page: number,
    sortby: string,
    word: string,
    metadata: SearchMetadata | undefined,
    useAllCatalog = false,
  ): Promise<{ nodes: ComicNode[]; nextPage?: number }> {
    let apiPage = page;
    for (let attempt = 0; attempt < MAX_EMPTY_BROWSE_PAGES; attempt++, apiPage++) {
      const response = await fetchBrowse(
        this.buildSelect(apiPage, sortby, word, metadata, useAllCatalog),
      );
      const nodes = response.get_comic_browse_items ?? [];
      const usable = nodes.filter((node) => Boolean(node.data.urlCover?.trim()));
      const hasNextPage = nodes.length === PAGE_SIZE;
      if (usable.length || !hasNextPage) {
        return { nodes: usable, nextPage: hasNextPage ? apiPage + 1 : undefined };
      }
    }
    return { nodes: [], nextPage: apiPage };
  }

  private canUseUnfilteredFeed(query: SearchQuery<SearchMetadata>): boolean {
    if ((query.title ?? "").trim()) return false;
    const metadata = query.metadata;
    const preferences = getPreferences();
    return (
      sameValues(metadata?.types ?? preferences.types, preferences.types) &&
      sameValues(
        metadata?.contentRatings ?? preferences.contentRatings,
        preferences.contentRatings,
      ) &&
      sameValues(metadata?.translatedLanguages ?? ["en"], ["en"]) &&
      !(metadata?.demographics?.length ?? 0) &&
      !Object.keys(metadata?.genres ?? {}).length &&
      !Object.keys(metadata?.tags ?? {}).length &&
      !(metadata?.originalLanguages?.length ?? 0) &&
      !(metadata?.originalStatus?.length ?? 0) &&
      !(metadata?.uploadStatus?.length ?? 0) &&
      !metadata?.chapCount?.trim() &&
      !metadata?.year?.trim() &&
      (metadata?.incGenresMode ?? "and") === "and" &&
      (metadata?.excGenresMode ?? "or") === "or"
    );
  }

  private async getLatestSearchResults(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const result = (await fetchLatestUpdates(metadata?.before)).get_comic_latestUploads;
    if (!result) return { items: [] };

    const preferences = getPreferences();
    const excluded = new Set([...preferences.excludedGenres, ...preferences.excludedTags]);
    const seen = new Set<string>();
    const nodes: ComicNode[] = [];
    for (const item of result.items ?? []) {
      const comic = item.comic?.data;
      if (
        !comic ||
        comic.translatedLanguage !== "en" ||
        !comic.urlCover?.trim() ||
        (comic.type && !preferences.types.some((type) => type === comic.type)) ||
        (comic.contentRating &&
          !preferences.contentRatings.some((rating) => rating === comic.contentRating)) ||
        comic.genres?.some((genre) => excluded.has(genre)) ||
        seen.has(comic.id)
      ) {
        continue;
      }
      seen.add(comic.id);
      nodes.push({ data: { ...comic, chapterNodes_last: item.chapters ?? [] } });
    }

    return {
      items: nodes.map(toSearchResultItem),
      metadata: result.before != null ? { before: result.before } : undefined,
    };
  }

  private async getRecentlyAddedSearchResults(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const result = parseRecentlyAdded(await fetchRecentlyAdded(), metadata?.page ?? 1);
    return {
      items: result.items,
      metadata: result.nextPage != null ? { page: result.nextPage } : undefined,
    };
  }

  private buildSelect(
    page: number,
    sortby: string,
    word: string,
    metadata: SearchMetadata | undefined,
    useAllCatalog = false,
  ): BrowseSelect {
    if (useAllCatalog) {
      return {
        where: "browse",
        page,
        size: PAGE_SIZE,
        init: (page - 1) * PAGE_SIZE,
        sortby,
        word,
        incOLangs: [],
        incTLangs: [],
        incGenres: [],
        excGenres: [],
        incGenresMode: null,
        excGenresMode: null,
        incTypes: [],
        incDemographics: [],
        incContentRatings: [],
        releaseYearMin: null,
        releaseYearMax: null,
        origStatus: null,
        siteStatus: null,
        chapCount: null,
        ignoreGlobalULangs: false,
        ignoreGlobalGenres: false,
        ignoreGlobalBlocks: false,
      };
    }

    const preferences = getPreferences();
    const includedGenres: string[] = [];
    const excludedGenres = [...preferences.excludedGenres, ...preferences.excludedTags];

    for (const [id, state] of Object.entries(metadata?.genres ?? {})) {
      (state === "excluded" ? excludedGenres : includedGenres).push(id);
    }
    for (const [id, state] of Object.entries(metadata?.tags ?? {})) {
      (state === "excluded" ? excludedGenres : includedGenres).push(id);
    }

    const year = metadata?.year?.trim() ?? "";
    let releaseYearMin: number | null = null;
    let releaseYearMax: number | null = null;
    if (year.includes("-")) {
      releaseYearMin = Number(year.split("-")[0]) || null;
      releaseYearMax = Number(year.split("-")[1]) || null;
    } else if (year) {
      releaseYearMin = Number(year) || null;
      releaseYearMax = releaseYearMin;
    }

    return {
      where: "browse",
      page,
      size: PAGE_SIZE,
      init: (page - 1) * PAGE_SIZE,
      sortby,
      word,
      incOLangs: metadata?.originalLanguages ?? [],
      incTLangs: metadata?.translatedLanguages ?? ["en"],
      incGenres: [...new Set(includedGenres)],
      excGenres: [...new Set(excludedGenres)],
      incGenresMode: metadata?.incGenresMode ?? "and",
      excGenresMode: metadata?.excGenresMode ?? "or",
      incTypes: metadata?.types?.length ? metadata.types : preferences.types,
      incDemographics: metadata?.demographics ?? [],
      incContentRatings: metadata?.contentRatings?.length
        ? metadata.contentRatings
        : preferences.contentRatings,
      releaseYearMin,
      releaseYearMax,
      origStatus: metadata?.originalStatus?.[0] ?? null,
      siteStatus: metadata?.uploadStatus?.[0] ?? null,
      chapCount: metadata?.chapCount ?? "",
      ignoreGlobalULangs: true,
      ignoreGlobalGenres: true,
      ignoreGlobalBlocks: true,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const match = /^https?:\/\/(?:www\.)?xcomic\.(?:me|net)\/comic\/([a-zA-Z0-9]+)/i.exec(
      query.trim(),
    );
    if (!match?.[1]) return undefined;
    const response = await fetchComic(match[1]);
    if (!response.get_comicNode) return undefined;
    const sourceManga = toSourceManga(response.get_comicNode);
    return {
      items: [
        {
          mangaId: sourceManga.mangaId,
          title: sourceManga.mangaInfo.primaryTitle,
          imageUrl: sourceManga.mangaInfo.thumbnailUrl,
          contentRating: sourceManga.mangaInfo.contentRating ?? ContentRating.EVERYONE,
        },
      ],
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const response = await fetchComic(mangaId);
    if (!response.get_comicNode) throw new Error(`Manga not found: ${mangaId}`);
    return toSourceManga(response.get_comicNode);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const first = await fetchChapters(sourceManga.mangaId, 1);
    const firstResult = first.get_comic_chapterList_uniqList;
    if (!firstResult) return [];
    const pageCount = firstResult.paging?.pages ?? 1;
    const responses = [
      first,
      ...(pageCount > 1
        ? await Promise.all(
            Array.from({ length: pageCount - 1 }, (_, index) =>
              fetchChapters(sourceManga.mangaId, index + 2),
            ),
          )
        : []),
    ];
    return responses.flatMap((response) =>
      (response.get_comic_chapterList_uniqList?.items ?? [])
        .filter((item) => item.data.dbStatus === "normal")
        .map((item) => toChapter(item.data, sourceManga)),
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const id = chapter.chapterId.split("/").pop()?.split("-")[0];
    if (!id) throw new Error(`Invalid XCOMIC chapter ID: ${chapter.chapterId}`);
    return parseChapterDetails(await fetchChapterPages(id), chapter);
  }
}

export const XCOMIC = new XComicExtension();
