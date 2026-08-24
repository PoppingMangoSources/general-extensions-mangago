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
  type FilterOptions,
  type PageMetadata,
  type SearchMetadata,
  type XComicPreferences,
} from "./models";
import {
  fetchBrowse,
  fetchBrowsePager,
  fetchChapterPages,
  fetchChapters,
  fetchComic,
  fetchLatestUploads,
  fetchRecentlyAdded,
  fetchRecentlyAddedMetadata,
  fetchSearchPage,
  XComicInterceptor,
} from "./network";
import {
  contentRatingForComic,
  isComicAllowed,
  parseChapterDetails,
  parseFilterOptions,
  parseRecentlyAdded,
  toChapter,
  toDiscoverItem,
  toLatestUploadNodes,
  toSearchResultItem,
  toSourceManga,
  type CarouselItemType,
} from "./parsers";
import type XComicConfig from "./pbconfig";

const sameValues = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value) => right.includes(value));

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
    Application.setState(undefined, STATE_KEYS.FILTER_OPTIONS);
    Application.invalidateDiscoverSections();
  }

  async getSettingsForm(): Promise<Form> {
    return new XComicSettingsForm(
      getPreferences(),
      getSectionOrder(),
      getVisibleSections(),
      await this.getFilterOptions(),
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
    const result = await this.getLatestUploadNodes(metadata?.before);
    return {
      items: result.nodes
        .map((node) => toDiscoverItem(node, "chapterUpdatesCarouselItem"))
        .filter((item): item is DiscoverSectionItem => item !== undefined),
      metadata: result.before != null ? { before: result.before } : undefined,
    };
  }

  private async getRecentlyAddedSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const result = await this.getRecentlyAddedItems(metadata?.page ?? 1);
    return {
      items: result.items.map((item) => ({
        type: "simpleCarouselItem",
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        contentRating: item.contentRating,
      })),
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
    const stored = Application.getState(STATE_KEYS.FILTER_OPTIONS) as FilterOptions | undefined;
    if (stored && Object.values(stored).every((group) => group.length)) return stored;
    const options = await (this.filterOptionsPromise ??=
      fetchSearchPage().then(parseFilterOptions));
    Application.setState(options, STATE_KEYS.FILTER_OPTIONS);
    return options;
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
    const seenCursors = new Set<number>();
    while (nodes.length < PAGE_SIZE) {
      const result = (await fetchLatestUploads(cursor)).get_comic_latestUploads;
      const next =
        typeof result?.before === "number" && Number.isFinite(result.before)
          ? result.before
          : undefined;
      for (const node of toLatestUploadNodes(result)) {
        if (seenIds.has(node.data.id) || !isComicAllowed(node.data, preferences, true)) continue;
        seenIds.add(node.data.id);
        nodes.push(node);
      }
      if (next == null || seenCursors.has(next)) return { nodes };
      seenCursors.add(next);
      cursor = next;
    }
    return { nodes, before: cursor };
  }

  private async getRecentlyAddedItems(
    page: number,
  ): Promise<{ items: SearchResultItem[]; nextPage?: number }> {
    const [feed, metadata] = await Promise.all([
      fetchRecentlyAdded().then(parseRecentlyAdded),
      fetchRecentlyAddedMetadata(),
    ]);
    const preferences = getPreferences();
    const nodes = new Map(
      (metadata.get_comic_recentlyAdded?.items ?? []).map((node) => [node.data.id, node]),
    );
    const items = feed.flatMap((item) => {
      const node = nodes.get(item.mangaId);
      if (!node || !isComicAllowed(node.data, preferences, true)) return [];
      return [{ ...item, contentRating: contentRatingForComic(node.data) }];
    });
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return {
      items: items.slice(start, end),
      nextPage: end < items.length ? page + 1 : undefined,
    };
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "", query.metadata);
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
  ): Promise<{ nodes: ComicNode[]; nextPage?: number }> {
    const preferences = this.getEffectivePreferences(metadata);
    let apiPage = page;
    const usable: ComicNode[] = [];
    const seen = new Set<string>();
    while (true) {
      const select = this.buildSelect(apiPage, sortby, word, metadata, preferences);
      const response = await fetchBrowse(select);
      const nodes = response.get_comic_browse_items ?? [];
      let added = 0;
      for (const node of nodes) {
        if (seen.has(node.data.id)) continue;
        seen.add(node.data.id);
        added++;
        if (isComicAllowed(node.data, preferences)) usable.push(node);
      }
      const pagerNext =
        nodes.length === PAGE_SIZE
          ? apiPage + 1
          : (await fetchBrowsePager(select)).get_comic_browse_pager?.next;
      const nextPage =
        typeof pagerNext === "number" && Number.isFinite(pagerNext) && pagerNext > 0
          ? pagerNext
          : undefined;
      if (usable.length >= PAGE_SIZE || nextPage == null || !added || nextPage === apiPage) {
        return { nodes: usable, nextPage };
      }
      apiPage = nextPage;
    }
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
      !Object.keys(metadata?.formats ?? {}).length &&
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
    const result = await this.getLatestUploadNodes(metadata?.before);

    return {
      items: result.nodes.map(toSearchResultItem),
      metadata: result.before != null ? { before: result.before } : undefined,
    };
  }

  private async getRecentlyAddedSearchResults(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const result = await this.getRecentlyAddedItems(metadata?.page ?? 1);
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
