/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
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
  type Tag,
} from "@paperback/types";

import { NovelArchiveAdvancedSearchForm } from "./forms/search";
import { getHideAdultContent, NovelArchiveSettingsForm } from "./forms/settings";
import {
  SECTIONS,
  SORT_OPTIONS,
  type ChapterContentResponse,
  type PageMetadata,
  type SearchMetadata,
  type SourceChapterContentResponse,
} from "./models";
import {
  buildNovelsUrl,
  fetchApi,
  fetchBrowse,
  fetchGenres,
  fetchNovel,
  fetchNovels,
  fetchSourceChapters,
  fetchSources,
  novelsUrl,
  NovelArchiveInterceptor,
  resolveUrlQuery,
} from "./network";
import {
  decodeId,
  filterAdultItems,
  mergeChapterVersions,
  novelUpdatedAt,
  parseChapterDetails,
  parseChapters,
  parseGenreOptions,
  parseMangaDetails,
  parseNovelList,
  parseSourceChapterDetails,
  parseSourceChapters,
  pickGenreValues,
  toCardItem,
  toChapterUpdateItem,
  toFeaturedItem,
  toGenreCarouselItems,
  toSearchResultItem,
} from "./parsers";
import type NovelArchiveConfig from "./pbconfig";

class NovelArchiveExtension implements ExtensionImpl<typeof NovelArchiveConfig> {
  private globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 20,
    bufferInterval: 10,
    ignoreImages: true,
  });
  private requestManager = new NovelArchiveInterceptor("main");
  private genresPromise?: Promise<Tag[]>;
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.requestManager.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    this.genresPromise = undefined;
  }

  async getSettingsForm(): Promise<Form> {
    return new NovelArchiveSettingsForm(await this.getGenres());
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.featured },
      { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.EDITORS, title: "Editor's Choice", type: DiscoverSectionType.featured },
      { id: SECTIONS.TOP_RATED, title: "Top Rated", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.MOST_CHAPTERS,
        title: "Most Chapters",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.TRENDING:
        return this.getFeaturedItems("trending", "trending");
      case SECTIONS.EDITORS:
        return this.getFeaturedItems("editors-choice", "editors");
      case SECTIONS.LATEST:
        return this.getLatestSection();
      case SECTIONS.POPULAR:
        return this.getCardItems("popular", "views", metadata);
      case SECTIONS.TOP_RATED:
        return this.getCardItems("rating", "rating", metadata);
      case SECTIONS.MOST_CHAPTERS:
        return this.getCardItems("chapters", "chapters", metadata);
      case SECTIONS.GENRES:
        return this.getGenresSection();
      default:
        return { items: [] };
    }
  }

  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchGenres().then(parseGenreOptions));
  }

  private async getGenresSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: toGenreCarouselItems(await this.getGenres(), getHideAdultContent()),
    };
  }

  private async getLatestSection(): Promise<PagedResults<DiscoverSectionItem>> {
    const novels = await fetchNovels(novelsUrl("recently-updated"));
    return {
      items: filterAdultItems(parseNovelList(novels), getHideAdultContent()).flatMap((item) => {
        const card = toChapterUpdateItem(item);
        return card ? [card] : [];
      }),
    };
  }

  private async getFeaturedItems(
    segment: string,
    variant: "trending" | "editors",
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const novels = await fetchNovels(novelsUrl(segment));
    return {
      items: filterAdultItems(parseNovelList(novels), getHideAdultContent()).map((item, index) =>
        toFeaturedItem(item, index, variant),
      ),
    };
  }

  private async getCardItems(
    sort: string,
    variant: "rating" | "chapters" | "views",
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const { novels, hasNext } = await fetchBrowse(buildNovelsUrl({ page, sort }));
    return {
      items: parseNovelList(novels).map((item) => toCardItem(item, variant)),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new NovelArchiveAdvancedSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const meta = query.metadata ?? {};
    const search = (query.title ?? "").trim();
    const page = metadata?.page ?? 1;

    const url = buildNovelsUrl({
      page,
      search: search || undefined,
      sort: sortingOption?.id,
      status: meta.status?.[0],
      genreMatch: meta.genreMatch?.[0],
      genresInclude: pickGenreValues(meta.genres, "included"),
      genresExclude: pickGenreValues(meta.genres, "excluded"),
    });

    const { novels, hasNext } = await fetchBrowse(url);
    return {
      items: parseNovelList(novels).map(toSearchResultItem),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchNovel(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = decodeId(sourceManga.mangaId);
    const [novel, sources] = await Promise.all([fetchNovel(sourceManga.mangaId), fetchSources(id)]);

    const publishDate = novelUpdatedAt(novel);
    const chapters = parseChapters(novel, sourceManga, publishDate);
    const perSource = await Promise.all(
      sources.map(async (source) =>
        parseSourceChapters(
          source,
          await fetchSourceChapters(id, source.id),
          sourceManga,
          publishDate,
        ),
      ),
    );

    return mergeChapterVersions(chapters, ...perSource);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const id = decodeId(chapter.sourceManga.mangaId);
    const separator = chapter.chapterId.lastIndexOf(":");

    // Mirror ids encode the source and chapter number around the final colon.
    if (separator >= 0) {
      const sourceId = decodeId(chapter.chapterId.slice(0, separator));
      const chapterNumber = decodeId(chapter.chapterId.slice(separator + 1));
      const data = await fetchApi<SourceChapterContentResponse>(
        novelsUrl(id, "sources", sourceId, "chapters", chapterNumber),
      );
      return parseSourceChapterDetails(data, chapter);
    }

    const data = await fetchApi<ChapterContentResponse>(
      novelsUrl(id, "chapters", chapter.chapterId),
    );
    return parseChapterDetails(data, chapter);
  }
}

export const NovelArchive = new NovelArchiveExtension();
