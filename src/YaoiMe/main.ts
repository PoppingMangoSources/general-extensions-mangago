/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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
  type UpdateManager,
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import {
  YaoiMeAdvancedSearchForm,
  YaoiMeSettingsForm,
  getPreferences,
  getSectionOrder,
  getVisibleSections,
} from "./forms";
import {
  DOMAIN,
  SECTION_DEFINITIONS,
  SECTIONS,
  SORT_OPTIONS,
  STATE_KEYS,
  type MangaCard,
  type PageMetadata,
  type SealKey,
  type SearchMetadata,
  type SearchFilters,
} from "./models";
import {
  YaoiMeInterceptor,
  fetchBrowsePage,
  fetchDiscoverPage,
  fetchFiltersPage,
  fetchChapterPage,
  fetchHomePage,
  fetchSeriesPage,
  fetchSealKey,
} from "./network";
import {
  hasNextPage,
  parseBrowseCards,
  decryptPageList,
  parseChapters,
  parseSearchFilters,
  parseLinkedMangaId,
  parseHomeCards,
  parseMangaDetails,
  parseMangaId,
  parseReaderPage,
  toFeaturedItem,
  toGenreItem,
  toLatestItem,
  toProminentItem,
  toSearchResult,
  toPageUrls,
  toSimpleItem,
  type ReaderPage,
} from "./parsers";
import type YaoiMeConfig from "./pbconfig";

class YaoiMeExtension implements ExtensionImpl<typeof YaoiMeConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new YaoiMeInterceptor("main", getPreferences, getSectionOrder);
  private homePromise?: Promise<CheerioAPI>;
  private filtersPromise?: Promise<SearchFilters>;
  private sealKeyPromise?: Promise<string>;

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
    // The reader's human check is passed in the site's own session, so every cookie is kept, not
    // only the Cloudflare clearance.
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
    this.clearMemos();
  }

  private clearMemos = (): void => {
    this.homePromise = undefined;
    this.filtersPromise = undefined;
  };

  async getSettingsForm(): Promise<Form> {
    return new YaoiMeSettingsForm(getPreferences(), getVisibleSections(), this.clearMemos);
  }

  // Discover asks for its sections on every refresh, so the home page is fetched fresh each time.
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    this.homePromise = undefined;
    const visible = new Set(getVisibleSections());
    return getSectionOrder()
      .filter((id) => visible.has(id))
      .map((id) => SECTION_DEFINITIONS[id]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.GENRES:
        return { items: (await this.getSearchFilters()).genres.map(toGenreItem) };
      case SECTIONS.POPULAR:
        return this.getHomeSectionItems("Popular updates", (card) => [toFeaturedItem(card)]);
      case SECTIONS.BINGE:
        return this.getRankingSectionItems(section.id, metadata, (card) => [toProminentItem(card)]);
      case SECTIONS.TRENDING:
        return this.getRankingSectionItems(section.id, metadata, (card) => [toSimpleItem(card)]);
      case SECTIONS.TOP_RATED:
        return this.getRankingSectionItems(section.id, metadata, (card) => [toSimpleItem(card)]);
      case SECTIONS.LATEST:
        return this.getHomeSectionItems("Latest releases", (card) => {
          const item = toLatestItem(card);
          return item ? [item] : [];
        });
      case SECTIONS.BOOKMARKED:
        return this.getRankingSectionItems(section.id, metadata, (card) => [
          toFeaturedItem(card, true),
        ]);
      case SECTIONS.HIDDEN_GEMS:
        return this.getRankingSectionItems(section.id, metadata, (card) => [toProminentItem(card)]);
      case SECTIONS.TALKED:
        return this.getRankingSectionItems(section.id, metadata, (card) => [toSimpleItem(card)]);
      case SECTIONS.RISING:
        return this.getRankingSectionItems(section.id, metadata, (card) => [toSimpleItem(card)]);
      default:
        return { items: [] };
    }
  }

  // Every row comes from the one home page, shared by the sections loading together.
  private async getHomeSectionItems(
    heading: string,
    toItems: (card: MangaCard) => DiscoverSectionItem[],
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await (this.homePromise ??= fetchHomePage().catch((error: unknown) => {
      this.homePromise = undefined;
      throw error;
    }));
    return { items: parseHomeCards($, heading).flatMap(toItems) };
  }

  private async getRankingSectionItems(
    section: string,
    metadata: PageMetadata | undefined,
    toItems: (card: MangaCard) => DiscoverSectionItem[],
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchDiscoverPage(section, page);
    return {
      items: parseBrowseCards($).flatMap(toItems),
      ...(hasNextPage($, page) ? { metadata: { page: page + 1 } } : {}),
    };
  }

  private getSearchFilters(): Promise<SearchFilters> {
    return (this.filtersPromise ??= fetchFiltersPage()
      .then(parseSearchFilters)
      .catch((error: unknown) => {
        this.filtersPromise = undefined;
        throw error;
      }));
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new YaoiMeAdvancedSearchForm(query, getPreferences(), await this.getSearchFilters());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title);
    if (pasted) return pasted;
    const preferences = getPreferences();
    const searchMetadata: SearchMetadata = {
      languages: preferences.chapterLanguages,
      ratings: preferences.contentRatings,
      types: preferences.contentTypes,
      ...query.metadata,
      tags: {
        ...Object.fromEntries(preferences.hiddenTags.map((tag) => [tag, "excluded"] as const)),
        ...query.metadata?.tags,
      },
    };
    const page = metadata?.page ?? 1;
    const $ = await fetchBrowsePage(
      page,
      query.title,
      searchMetadata,
      sortingOption?.id ?? SORT_OPTIONS[0].id,
    );
    return {
      items: parseBrowseCards($).map(toSearchResult),
      ...(hasNextPage($, page) ? { metadata: { page: page + 1 } } : {}),
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query
      .trim()
      .match(
        /^https?:\/\/(?:www\.)?yaoi\.me\/(?:series\/\d+(?:\/[a-zA-Z0-9._~-]+)?|chapter\/\d+\/\d+)\/?(?:[?#].*)?$/i,
      )?.[0];
    if (!url) return undefined;
    let mangaId = parseMangaId(url);
    let $ = await fetchSeriesPage(url.replace(/^https?:\/\/(?:www\.)?yaoi\.me/i, ""));
    if (!mangaId) {
      mangaId = parseLinkedMangaId($);
      if (!mangaId) throw new Error("No series link found on this chapter page.");
      $ = await fetchSeriesPage(mangaId);
    } else {
      mangaId = parseLinkedMangaId($) || mangaId;
    }
    const manga = parseMangaDetails($, mangaId);
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
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchSeriesPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const preferences = getPreferences();
    return parseChapters(
      await fetchSeriesPage(sourceManga.mangaId),
      sourceManga,
      preferences.chapterLanguages,
      preferences.deduplicateChapters,
    );
  }

  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    const [first] = updateManager.getQueuedItems();
    if (!first) return;
    try {
      await fetchSeriesPage(first.mangaId);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const reader = parseReaderPage(await fetchChapterPage(chapter.chapterId));
    let hashes = reader.hashes.filter(Boolean);
    if (reader.sealed) {
      try {
        hashes = await decryptPageList(reader.sealed, await this.getSealKey(reader));
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        // A kept key can predate a deploy that reused the build id, so the scripts are read again.
        try {
          hashes = await decryptPageList(reader.sealed, await this.getSealKey(reader, true));
        } catch (retryError) {
          if (retryError instanceof CloudflareError) throw retryError;
          throw new Error(`Could not decrypt the page list for chapter ${chapter.chapterId}.`, {
            cause: retryError,
          });
        }
      }
      if (!hashes.length)
        throw new Error(`The page list for chapter ${chapter.chapterId} is empty.`);
    }
    if (hashes.length) {
      return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        pages: toPageUrls(hashes),
      };
    }
    // The site leaves the page list out until the reader's human check has been passed, which only
    // happens in a browser, so the chapter is opened there.
    throw new CloudflareError({
      url: `${DOMAIN}${chapter.chapterId}`,
      method: "GET",
      headers: { "user-agent": await Application.getDefaultUserAgent() },
    });
  }

  // The key is kept per build so it is read from the site's scripts once per deploy, not per chapter.
  private async getSealKey(reader: ReaderPage, refresh = false): Promise<string> {
    const stored = Application.getState(STATE_KEYS.SEAL_KEY) as SealKey | undefined;
    if (!refresh && reader.build && stored?.build === reader.build) return stored.key;
    const key = await (this.sealKeyPromise ??= fetchSealKey(reader.scripts).finally(() => {
      this.sealKeyPromise = undefined;
    }));
    if (reader.build)
      Application.setState({ build: reader.build, key } satisfies SealKey, STATE_KEYS.SEAL_KEY);
    return key;
  }
}

export const YaoiMe = new YaoiMeExtension();
