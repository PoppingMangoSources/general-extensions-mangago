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
  GENRE_OPTIONS,
  PAGE_SIZE,
  SECTIONS,
  SORTING_OPTIONS,
  type BrowseSelect,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchBrowse,
  fetchChapterHtml,
  fetchChapters,
  fetchComic,
  fetchLatestUploads,
  XComicInterceptor,
} from "./network";
import {
  parseChapterDetails,
  parseLatestUploads,
  toAbsoluteUrl,
  toChapter,
  toDiscoverItem,
  toSearchResultItem,
  toSourceManga,
  type CarouselItemType,
} from "./parsers";
import type XComicConfig from "./pbconfig";

class XComicExtension implements ExtensionImpl<typeof XComicConfig> {
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
    Application.invalidateDiscoverSections();
  }

  async getSettingsForm(): Promise<Form> {
    return new XComicSettingsForm(getPreferences(), getSectionOrder(), getVisibleSections());
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
        return this.getBrowseSection(metadata, "field_create", "simpleCarouselItem");
      case SECTIONS.MOST_CHAPTERS:
        return this.getBrowseSection(metadata, "field_chapter", "simpleCarouselItem");
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

  private async getBrowseSection(
    metadata: PageMetadata | undefined,
    sortby: string,
    itemType: CarouselItemType,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const response = await fetchBrowse(this.buildSelect(page, sortby, "", undefined));
    const nodes = response.get_comic_browse_items ?? [];
    return {
      items: nodes
        .filter((node) => Boolean(node.data.urlCover?.trim()))
        .map((node) => toDiscoverItem(node, itemType))
        .filter((item): item is DiscoverSectionItem => item !== undefined),
      metadata: response.get_comic_browse_pager?.next ? { page: page + 1 } : undefined,
    };
  }

  private getGenreSection(): PagedResults<DiscoverSectionItem> {
    return {
      items: GENRE_OPTIONS.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
        },
      })),
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new XComicAdvancedSearchForm(query, getPreferences());
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

    const page = metadata?.page ?? 1;
    const select = this.buildSelect(
      page,
      sortingOption?.id ?? "field_score",
      (query.title ?? "").trim(),
      query.metadata,
    );
    const response = await fetchBrowse(select);
    const nodes = response.get_comic_browse_items ?? [];
    return {
      items: nodes.filter((node) => Boolean(node.data.urlCover?.trim())).map(toSearchResultItem),
      metadata: response.get_comic_browse_pager?.next ? { page: page + 1 } : undefined,
    };
  }

  private buildSelect(
    page: number,
    sortby: string,
    word: string,
    metadata: SearchMetadata | undefined,
  ): BrowseSelect {
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
    const chapters: Chapter[] = [];
    let page = 1;
    while (true) {
      const response = await fetchChapters(sourceManga.mangaId, page);
      const result = response.get_comic_chapterList_uniqList;
      if (!result) break;
      chapters.push(
        ...(result.items ?? [])
          .filter((item) => item.data.dbStatus === "normal")
          .map((item) => toChapter(item.data, sourceManga)),
      );
      if (!result.paging?.next) break;
      page++;
    }
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(await fetchChapterHtml(toAbsoluteUrl(chapter.chapterId)), chapter);
  }
}

export const XCOMIC = new XComicExtension();
