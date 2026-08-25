/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
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
} from "@paperback/types";

import { XComicAdvancedSearchForm } from "./forms/search";
import { XComicSettingsForm, getPreferences, getVisibleSections } from "./forms/settings";
import {
  DISCOVER_SECTIONS,
  MAX_LATEST_REQUESTS,
  MOST_VIEWS_OPTIONS,
  PAGE_SIZE,
  SECTION_IDS,
  SECTIONS,
  SORTING_OPTIONS,
  type BrowseSelect,
  type ComicNode,
  type FilterOptions,
  type PageMetadata,
  type SearchMetadata,
  type XComicPreferences,
} from "./models";
import {
  fetchBrowse,
  fetchChapterPages,
  fetchChapters,
  fetchComic,
  fetchLatestUploads,
  fetchRecentlyAdded,
  fetchSearchPage,
  XComicInterceptor,
} from "./network";
import {
  isComicAllowed,
  parseChapterDetails,
  parseFilterOptions,
  toChapter,
  toDiscoverItem,
  toLatestUploadNodes,
  toSearchResultItem,
  toSourceManga,
} from "./parsers";
import type XComicConfig from "./pbconfig";

class XComicExtension implements ExtensionImpl<typeof XComicConfig> {
  private filterOptionsPromise?: Promise<FilterOptions>;
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
    this.filterOptionsPromise = undefined;
    Application.invalidateDiscoverSections();
  }

  async getSettingsForm(): Promise<Form> {
    return new XComicSettingsForm(
      getPreferences(),
      getVisibleSections(),
      await this.getFilterOptions(),
    );
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const visible = new Set(getVisibleSections());
    return SECTION_IDS.filter((id) => visible.has(id)).map((id) => DISCOVER_SECTIONS[id]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.TOP_RATED:
        return this.getTopRatedSection(metadata);
      case SECTIONS.LATEST_UPLOADS:
        return this.getLatestUploadsSection(metadata);
      case SECTIONS.RECENTLY_ADDED:
        return this.getRecentlyAddedSection();
      case SECTIONS.MOST_VIEWS:
        return this.getMostViewsSection();
      case SECTIONS.GENRES:
        return this.getGenresSection();
      default:
        return { items: [] };
    }
  }

  private async getLatestUploadsSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const result = await this.getLatestUploadNodes(metadata?.before);
    return {
      items: result.nodes
        .map((node) => toDiscoverItem(node, "chapterUpdatesCarouselItem"))
        .filter((item): item is DiscoverSectionItem => item !== undefined),
      metadata: result.before != null ? { before: result.before } : undefined,
    };
  }

  private async getRecentlyAddedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const preferences = getPreferences();
    const nodes = (await fetchRecentlyAdded()).get_comic_recentlyAdded?.items ?? [];
    return {
      items: nodes
        .filter((node) => isComicAllowed(node.data, preferences, true))
        .map((node) => toDiscoverItem(node, "simpleCarouselItem"))
        .filter((item): item is DiscoverSectionItem => item !== undefined),
    };
  }

  private async getTopRatedSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const result = await this.getBrowsePage(page, "field_score", "", undefined);
    return {
      items: result.nodes
        .map((node) => toDiscoverItem(node, "featuredCarouselItem"))
        .filter((item): item is DiscoverSectionItem => item !== undefined),
      metadata: result.nextPage != null ? { page: result.nextPage } : undefined,
    };
  }

  private async getGenresSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: (await this.getFilterOptions()).genres.map((genre) => ({
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

  private async getFilterOptions(): Promise<FilterOptions> {
    return await (this.filterOptionsPromise ??= fetchSearchPage().then(parseFilterOptions));
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new XComicAdvancedSearchForm(query, getPreferences(), await this.getFilterOptions());
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  private getEffectivePreferences(metadata?: SearchMetadata): XComicPreferences {
    const preferences = getPreferences();
    return {
      ...preferences,
      contentRatings: metadata?.contentRatings?.length
        ? metadata.contentRatings.filter((rating) => preferences.contentRatings.includes(rating))
        : preferences.contentRatings,
      excludedFormats: [
        ...preferences.excludedFormats,
        ...Object.entries(metadata?.formats ?? {}).flatMap(([id, state]) =>
          state === "excluded" ? [id] : [],
        ),
      ],
      excludedGenres: [
        ...preferences.excludedGenres,
        ...Object.entries(metadata?.genres ?? {}).flatMap(([id, state]) =>
          state === "excluded" ? [id] : [],
        ),
      ],
      types: metadata?.types?.length
        ? metadata.types.filter((type) => preferences.types.includes(type))
        : preferences.types,
    };
  }

  private async getLatestUploadNodes(
    before?: number,
  ): Promise<{ nodes: ComicNode[]; before?: number }> {
    const preferences = getPreferences();
    const nodes: ComicNode[] = [];
    const seenIds = new Set<string>();
    let cursor = before;
    // The feed carries every language and type, so keep walking it until a page survives filtering.
    for (let request = 0; request < MAX_LATEST_REQUESTS && !nodes.length; request++) {
      const result = (await fetchLatestUploads(cursor)).get_comic_latestUploads;
      for (const node of toLatestUploadNodes(result)) {
        if (seenIds.has(node.data.id) || !isComicAllowed(node.data, preferences, true)) continue;
        seenIds.add(node.data.id);
        nodes.push(node);
      }
      cursor =
        typeof result?.before === "number" && Number.isFinite(result.before)
          ? result.before
          : undefined;
      if (cursor == null) break;
    }
    return { nodes, before: cursor };
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "", query.metadata);
    if (pasted) return pasted;

    const sortby = query.metadata?.discoverSort ?? sortingOption?.id ?? "field_score";
    const page = metadata?.page ?? 1;
    const result = await this.getBrowsePage(
      page,
      sortby,
      (query.title ?? "").trim(),
      query.metadata,
    );
    return {
      items: result.nodes.map(toSearchResultItem),
      metadata: result.nextPage != null ? { page: result.nextPage } : undefined,
    };
  }

  private async getBrowsePage(
    page: number,
    sortby: string,
    word: string,
    metadata: SearchMetadata | undefined,
  ): Promise<{ nodes: ComicNode[]; nextPage?: number }> {
    const preferences = this.getEffectivePreferences(metadata);
    const select = this.buildBrowseSelect(page, sortby, word, metadata, preferences);
    const nodes = (await fetchBrowse(select)).get_comic_browse_items ?? [];
    return {
      nodes: nodes.filter((node) => isComicAllowed(node.data, preferences)),
      nextPage: nodes.length === PAGE_SIZE ? page + 1 : undefined,
    };
  }

  private buildBrowseSelect(
    page: number,
    sortby: string,
    word: string,
    metadata: SearchMetadata | undefined,
    preferences: XComicPreferences,
  ): BrowseSelect {
    const includedGenres: string[] = [];
    const excludedGenres = [...preferences.excludedGenres, ...preferences.excludedFormats];
    for (const [id, state] of Object.entries(metadata?.genres ?? {})) {
      if (state === "included") includedGenres.push(id);
    }
    for (const [id, state] of Object.entries(metadata?.formats ?? {})) {
      if (state === "included") includedGenres.push(id);
    }

    const year = metadata?.year?.trim() ?? "";
    let releaseYearMin: number | null = null;
    let releaseYearMax: number | null = null;
    if (year.includes("-")) {
      const [from, to] = year.split("-").map((part) => Number(part) || null);
      // The site labels its ranges newest-first ("2009-2005"), so accept either order.
      releaseYearMin = from != null && to != null ? Math.min(from, to) : (from ?? to);
      releaseYearMax = from != null && to != null ? Math.max(from, to) : (from ?? to);
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
      incTLangs: metadata?.translatedLanguages ?? preferences.languages,
      incGenres: [...new Set(includedGenres)],
      excGenres: [...new Set(excludedGenres)],
      incGenresMode: metadata?.incGenresMode ?? "and",
      excGenresMode: metadata?.excGenresMode ?? "or",
      incTypes: preferences.types,
      incDemographics: metadata?.demographics ?? [],
      incContentRatings: preferences.contentRatings,
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
    metadata?: SearchMetadata,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const match = /^https?:\/\/(?:www\.)?xcomic\.(?:me|net)\/comic\/([a-zA-Z0-9]+)/i.exec(
      query.trim(),
    );
    if (!match?.[1]) return undefined;
    const response = await fetchComic(match[1]);
    if (!response.get_comicNode) return undefined;
    if (!isComicAllowed(response.get_comicNode.data, this.getEffectivePreferences(metadata))) {
      return { items: [] };
    }
    return { items: [toSearchResultItem(response.get_comicNode)] };
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
