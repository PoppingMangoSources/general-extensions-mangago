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
  type FeaturedMetric,
  type FilterOptions,
  type PageMetadata,
  type SearchMetadata,
  type TriState,
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
  fetchTitlePage,
  XComicInterceptor,
} from "./network";
import {
  isComicAllowed,
  parseChapterDetails,
  parseFilterOptions,
  parseTitleComicId,
  parseTitleMangaId,
  toChapter,
  toDiscoverItems,
  toLatestUploadNodes,
  toSearchResultItem,
  toSourceManga,
  titleMangaId,
} from "./parsers";
import type XComicConfig from "./pbconfig";

const idsWithState = (states: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.entries(states ?? {}).flatMap(([id, value]) => (value === state ? [id] : []));

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
        return this.getRankedSection(metadata, "field_score", "top");
      case SECTIONS.MOST_FOLLOWS:
        return this.getRankedSection(metadata, "field_follow", "follows");
      case SECTIONS.MOST_CHAPTERS:
        return this.getRankedSection(metadata, "field_chapter", "chapters");
      case SECTIONS.MOST_REVIEWS:
        return this.getRankedSection(metadata, "field_review", "reviews");
      case SECTIONS.MOST_COMMENTS:
        return this.getRankedSection(metadata, "field_comment", "comments");
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
      items: toDiscoverItems(result.nodes, "chapterUpdatesCarouselItem"),
      metadata: result.before != null ? { before: result.before } : undefined,
    };
  }

  private async getRecentlyAddedSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const preferences = getPreferences();
    const nodes = (await fetchRecentlyAdded()).get_comic_recentlyAdded?.items ?? [];
    return {
      items: toDiscoverItems(
        nodes.filter((node) => isComicAllowed(node.data, preferences)),
        "simpleCarouselItem",
      ),
    };
  }

  private async getRankedSection(
    metadata: PageMetadata | undefined,
    sortBy: string,
    metric: FeaturedMetric,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const result = await this.getBrowsePage(page, sortBy, "", undefined);
    return {
      items: toDiscoverItems(
        result.nodes,
        "featuredCarouselItem",
        metric,
        result.translatedLanguages,
      ),
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

  async getSortingOptions(query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    const discoverSort = query.metadata?.discoverSort;
    const selectedOption = SORTING_OPTIONS.find((option) => option.id === discoverSort);
    // Paperback selects the first option when a Discover chip opens Search.
    return selectedOption
      ? [selectedOption, ...SORTING_OPTIONS.filter((option) => option.id !== discoverSort)]
      : SORTING_OPTIONS;
  }

  private getEffectivePreferences(metadata?: SearchMetadata): XComicPreferences {
    const preferences = getPreferences();
    return {
      ...preferences,
      contentRatings: metadata?.contentRatings?.length
        ? metadata.contentRatings
        : preferences.contentRatings,
      excludedFormats: [
        ...preferences.excludedFormats,
        ...idsWithState(metadata?.formats, "excluded"),
      ],
      excludedGenres: [
        ...preferences.excludedGenres,
        ...idsWithState(metadata?.genres, "excluded"),
      ],
      types: metadata?.types?.length ? metadata.types : preferences.types,
      originalLanguages: metadata?.originalLanguages?.length
        ? metadata.originalLanguages
        : preferences.originalLanguages,
      translatedLanguages: metadata?.translatedLanguages?.length
        ? metadata.translatedLanguages
        : preferences.translatedLanguages,
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
    for (let attempt = 0; attempt < MAX_LATEST_REQUESTS && !nodes.length; attempt++) {
      const result = (await fetchLatestUploads(cursor)).get_comic_latestUploads;
      for (const node of toLatestUploadNodes(result)) {
        if (seenIds.has(node.data.id) || !isComicAllowed(node.data, preferences)) continue;
        seenIds.add(node.data.id);
        nodes.push(node);
      }
      cursor =
        typeof result?.before === "number" && Number.isFinite(result.before)
          ? result.before
          : undefined;
      if (cursor == null) break;
    }
    // Advertising a cursor after an empty walk makes the app page forever, 10 requests at a time.
    return { nodes, before: nodes.length ? cursor : undefined };
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title ?? "").trim();
    const pasted = await this.resolveUrlQuery(title, query.metadata);
    if (pasted) return pasted;

    const sortBy = sortingOption?.id ?? query.metadata?.discoverSort ?? "field_score";
    const page = metadata?.page ?? 1;
    const result = await this.getBrowsePage(page, sortBy, title, query.metadata);
    return {
      items: result.nodes.map((node) => toSearchResultItem(node, result.translatedLanguages)),
      metadata: result.nextPage != null ? { page: result.nextPage } : undefined,
    };
  }

  private async getBrowsePage(
    page: number,
    sortBy: string,
    word: string,
    metadata: SearchMetadata | undefined,
  ): Promise<{ nodes: ComicNode[]; nextPage?: number; translatedLanguages: string[] }> {
    const preferences = this.getEffectivePreferences(metadata);
    const select = this.buildBrowseSelect(page, sortBy, word, metadata, preferences);
    const response = await fetchBrowse(select);
    const nodes = response.get_title_browse_items ?? [];
    return {
      nodes: nodes.filter((node) => isComicAllowed(node.data, preferences)),
      nextPage: response.get_title_browse_pager?.next ?? undefined,
      translatedLanguages: preferences.translatedLanguages,
    };
  }

  private buildBrowseSelect(
    page: number,
    sortBy: string,
    word: string,
    metadata: SearchMetadata | undefined,
    preferences: XComicPreferences,
  ): BrowseSelect {
    const includedTagIds = [
      ...idsWithState(metadata?.genres, "included"),
      ...idsWithState(metadata?.formats, "included"),
    ];
    const excludedTagIds = [...preferences.excludedGenres, ...preferences.excludedFormats];

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
      sortby: sortBy,
      word,
      incOLangs: preferences.originalLanguages,
      incTLangs: preferences.translatedLanguages,
      incGenres: [...new Set(includedTagIds)],
      excGenres: [...new Set(excludedTagIds)],
      incGenresMode: metadata?.incGenresMode ?? "and",
      excGenresMode: metadata?.excGenresMode ?? "or",
      incTypes: preferences.types,
      incDemographics: metadata?.demographics ?? [],
      incContentRatings: preferences.contentRatings,
      releaseYearMin,
      releaseYearMax,
      origStatus: metadata?.originalStatus?.[0] ?? null,
      chapCount: metadata?.chapCount ?? "",
      ignoreGlobalULangs: false,
      ignoreGlobalGenres: false,
      ignoreGlobalBlocks: false,
    };
  }

  private async resolveUrlQuery(
    title: string,
    metadata?: SearchMetadata,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const match = /^https?:\/\/(?:www\.)?xcomic\.(?:me|net)\/(comic|title)\/([a-zA-Z0-9]+)/i.exec(
      title,
    );
    if (!match?.[1] || !match[2]) return undefined;
    const preferences = this.getEffectivePreferences(metadata);
    const response =
      match[1] === "title"
        ? await this.fetchTitleComic(match[2], preferences.translatedLanguages)
        : await fetchComic(match[2]);
    if (!response.get_comicNode) return undefined;
    if (!isComicAllowed(response.get_comicNode.data, preferences)) {
      return { items: [] };
    }
    const mangaId =
      match[1] === "title" && response.get_comicNode.data.translatedLanguage
        ? titleMangaId(match[2], response.get_comicNode.data.translatedLanguage)
        : match[2];
    return { items: [toSearchResultItem(response.get_comicNode, [], mangaId)] };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const title = parseTitleMangaId(mangaId);
    const response = title
      ? await this.fetchTitleComic(title.titleId, [title.language])
      : await fetchComic(mangaId);
    if (!response.get_comicNode) throw new Error(`Manga not found: ${mangaId}`);
    return toSourceManga(response.get_comicNode, mangaId);
  }

  private async fetchTitleComic(titleId: string, languages: string[]) {
    const comicId = parseTitleComicId(await fetchTitlePage(titleId), languages);
    if (!comicId) {
      throw new Error(`XCOMIC has no selected-language source for title ${titleId}`);
    }
    return await fetchComic(comicId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const title = parseTitleMangaId(sourceManga.mangaId);
    const comicId = title
      ? /\/comic\/([a-zA-Z0-9]+)/i.exec(sourceManga.mangaInfo.shareUrl ?? "")?.[1]
      : sourceManga.mangaId;
    if (!comicId) throw new Error(`XCOMIC could not resolve a source for ${sourceManga.mangaId}`);
    const first = await fetchChapters(comicId, 1);
    const firstResult = first.get_comic_chapterList_uniqList;
    if (!firstResult) return [];
    const pageCount = firstResult.paging?.pages ?? 1;
    const responses = [
      first,
      ...(await Promise.all(
        Array.from({ length: pageCount - 1 }, (_, index) => fetchChapters(comicId, index + 2)),
      )),
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
