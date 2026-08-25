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
} from "@paperback/types";
import type { CheerioAPI } from "cheerio";

import {
  getSectionOrder,
  getVisibleSections,
  MvlempyrAdvancedSearchForm,
  MvlempyrSettingsForm,
} from "./forms";
import {
  CATALOGUE_PAGE_SIZE,
  GENRES,
  HOME_SECTION_CLASSES,
  NOVEL_CODE_KEY_PREFIX,
  PAGE_SIZE,
  SECTION_DEFINITIONS,
  SECTIONS,
  SORT_OPTIONS,
  type CatalogueNovel,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  chapterPageUrl,
  fetchCataloguePage,
  fetchDocument,
  fetchHomePage,
  fetchLatestChapterPosts,
  fetchNovelChapterPosts,
  fetchNovelPage,
  MvlempyrInterceptor,
} from "./network";
import {
  buildChapters,
  chapterTagId,
  contentRatingForGenres,
  parseChapterDetails,
  parseHomeCards,
  parseNovelCode,
  parseNovelDetails,
  parseNovelSlug,
  toCatalogueNovel,
  toChapterUpdateItem,
  toFeaturedCatalogueItem,
  toFeaturedHomeItem,
  toSearchResultItem,
  toSimpleCatalogueItem,
  toSimpleHomeItem,
} from "./parsers";
import type MvlempyrConfig from "./pbconfig";

const triStateValues = (
  genres: SearchMetadata["genres"],
  state: "included" | "excluded",
): string[] =>
  Object.entries(genres ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => id);

const CATALOGUE_SORTERS: Record<string, (a: CatalogueNovel, b: CatalogueNovel) => number> = {
  reviews: (a, b) => (b.reviews ?? 0) - (a.reviews ?? 0),
  rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
  new: (a, b) => (b.created ?? 0) - (a.created ?? 0),
  chapters: (a, b) => (b.chapters ?? 0) - (a.chapters ?? 0),
  "chapters-asc": (a, b) => (a.chapters ?? 0) - (b.chapters ?? 0),
  az: (a, b) => a.name.localeCompare(b.name),
  za: (a, b) => b.name.localeCompare(a.name),
};

class MvlempyrExtension implements ExtensionImpl<typeof MvlempyrConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new MvlempyrInterceptor("main");
  private homePromise?: Promise<CheerioAPI>;
  private cataloguePromise?: Promise<CatalogueNovel[]>;

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
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    this.homePromise = undefined;
    this.cataloguePromise = undefined;
  }

  async getSettingsForm(): Promise<Form> {
    return new MvlempyrSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const visible = new Set(getVisibleSections());
    return getSectionOrder()
      .filter((id) => visible.has(id))
      .map((id) => SECTION_DEFINITIONS[id]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    switch (section.id) {
      case SECTIONS.POPULAR:
        return this.getHomeSection(HOME_SECTION_CLASSES.POPULAR, toFeaturedHomeItem);
      case SECTIONS.TRENDING:
        return this.getHomeSection(HOME_SECTION_CLASSES.TRENDING, toSimpleHomeItem);
      case SECTIONS.RECOMMENDED:
        return this.getHomeSection(HOME_SECTION_CLASSES.RECOMMENDED, toSimpleHomeItem);
      case SECTIONS.TOP_RATED:
        return this.getCatalogueSection("rating", page, toFeaturedCatalogueItem);
      case SECTIONS.NEW_UPDATES:
        return this.getNewUpdatesSection(page);
      case SECTIONS.COMPLETED:
        return this.getHomeSection(HOME_SECTION_CLASSES.COMPLETED, toSimpleHomeItem);
      case SECTIONS.NEW_ARRIVALS:
        return this.getCatalogueSection("new", page, toSimpleCatalogueItem);
      case SECTIONS.MOST_REVIEWED:
        return this.getCatalogueSection("reviews", page, toFeaturedCatalogueItem);
      case SECTIONS.ROMANCE:
        return this.getHomeSection(HOME_SECTION_CLASSES.ROMANCE, toSimpleHomeItem);
      case SECTIONS.GENRES:
        return {
          items: GENRES.map((genre) => ({
            type: "genresCarouselItem",
            name: genre.title,
            searchQuery: {
              title: "",
              metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
            },
            contentRating: contentRatingForGenres([genre.id]),
          })),
        };
      default:
        return { items: [] };
    }
  }

  private async getHomeSection(
    sectionClass: string,
    mapper: (card: ReturnType<typeof parseHomeCards>[number]) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    return { items: parseHomeCards(await this.getHomePage(), sectionClass).map(mapper) };
  }

  private async getCatalogueSection(
    sort: string,
    page: number,
    toItem: (novel: CatalogueNovel) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const novels = [...(await this.getCatalogue())].sort(CATALOGUE_SORTERS[sort]);
    const start = (page - 1) * PAGE_SIZE;
    return {
      items: novels.slice(start, start + PAGE_SIZE).map(toItem),
      metadata: start + PAGE_SIZE < novels.length ? { page: page + 1 } : undefined,
    };
  }

  private async getNewUpdatesSection(page: number): Promise<PagedResults<DiscoverSectionItem>> {
    const [{ posts, totalPages }, catalogue] = await Promise.all([
      fetchLatestChapterPosts(page),
      this.getCatalogue(),
    ]);
    const byCode = new Map(catalogue.map((novel) => [novel.code, novel]));
    return {
      items: posts.flatMap((post) => {
        const code = Number(post.acf?.novel_code);
        const novel = byCode.get(code);
        const item = novel ? toChapterUpdateItem(post, novel) : undefined;
        return item ? [item] : [];
      }),
      metadata: page < totalPages ? { page: page + 1 } : undefined,
    };
  }

  private async getHomePage(): Promise<CheerioAPI> {
    const request = (this.homePromise ??= fetchHomePage());
    try {
      return await request;
    } finally {
      if (this.homePromise === request) this.homePromise = undefined;
    }
  }

  private async getCatalogue(): Promise<CatalogueNovel[]> {
    const request = (this.cataloguePromise ??= this.loadCatalogue());
    try {
      return await request;
    } catch (error) {
      if (this.cataloguePromise === request) this.cataloguePromise = undefined;
      throw error;
    }
  }

  private async loadCatalogue(): Promise<CatalogueNovel[]> {
    const novels: CatalogueNovel[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await fetchCataloguePage(page);
      for (const entry of batch) {
        const novel = toCatalogueNovel(entry);
        if (novel) novels.push(novel);
      }
      if (batch.length < CATALOGUE_PAGE_SIZE) break;
    }
    return novels;
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MvlempyrAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const searchMetadata: SearchMetadata = query.metadata ?? {
      genres: {},
      genreMatch: [],
      statuses: [],
      author: "",
      minChapters: "",
      maxChapters: "",
    };

    const title = query.title.trim().toLowerCase();
    const author = searchMetadata.author?.trim().toLowerCase();
    const included = triStateValues(searchMetadata.genres, "included").map((id) =>
      id.toLowerCase(),
    );
    const excluded = triStateValues(searchMetadata.genres, "excluded").map((id) =>
      id.toLowerCase(),
    );
    const matchAny = searchMetadata.genreMatch?.[0] === "or";
    const status = searchMetadata.statuses?.[0];
    const minChapters = Number.parseInt(searchMetadata.minChapters ?? "", 10);
    const maxChapters = Number.parseInt(searchMetadata.maxChapters ?? "", 10);

    const filtered = (await this.getCatalogue()).filter((novel) => {
      if (title && !novel.name.toLowerCase().includes(title)) return false;
      if (author && !(novel.author ?? "").toLowerCase().includes(author)) return false;
      const genres = novel.genres.map((genre) => genre.toLowerCase());
      if (included.length > 0) {
        const matches = included.filter((genre) => genres.includes(genre)).length;
        if (matchAny ? matches === 0 : matches < included.length) return false;
      }
      if (excluded.some((genre) => genres.includes(genre))) return false;
      if (status && (novel.status ?? "").toLowerCase() !== status) return false;
      if (Number.isFinite(minChapters) && (novel.chapters ?? 0) < minChapters) return false;
      if (Number.isFinite(maxChapters) && (novel.chapters ?? 0) > maxChapters) return false;
      return true;
    });

    const sorter = CATALOGUE_SORTERS[sortingOption?.id ?? SORT_OPTIONS[0].id];
    const sorted = [...filtered].sort(sorter);
    const start = (page - 1) * PAGE_SIZE;
    return {
      items: sorted.slice(start, start + PAGE_SIZE).map(toSearchResultItem),
      metadata: start + PAGE_SIZE < sorted.length ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query
      .trim()
      .match(
        /^https?:\/\/(?:www\.)?(?:mvlempyr\.(?:io|com|net|app)|heliosarchive\.online)\/novel\/[^/?#]+\/?$/i,
      )?.[0];
    if (!url) return undefined;
    const mangaId = parseNovelSlug(url);
    if (!mangaId) return undefined;
    try {
      const manga = await this.getMangaDetails(mangaId);
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
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await fetchNovelPage(mangaId);
    const code = parseNovelCode($);
    if (code != null) Application.setState(code, `${NOVEL_CODE_KEY_PREFIX}${mangaId}`);
    return parseNovelDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const code = await this.getNovelCode(sourceManga.mangaId);
    const tagId = chapterTagId(code);
    const { posts, totalPages } = await fetchNovelChapterPosts(tagId, 1);
    const remaining = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        fetchNovelChapterPosts(tagId, index + 2).then((result) => result.posts),
      ),
    );
    const chapters = buildChapters([posts, ...remaining].flat(), sourceManga);
    if (chapters.length === 0) {
      throw new Error(`No chapters found for ${sourceManga.mangaId}.`);
    }
    return chapters;
  }

  private async getNovelCode(mangaId: string): Promise<number> {
    const stored = Application.getState(`${NOVEL_CODE_KEY_PREFIX}${mangaId}`) as number | undefined;
    if (stored != null) return stored;
    const code = parseNovelCode(await fetchNovelPage(mangaId));
    if (code == null) {
      throw new Error(`Unable to resolve the novel code for ${mangaId}.`);
    }
    Application.setState(code, `${NOVEL_CODE_KEY_PREFIX}${mangaId}`);
    return code;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(await fetchDocument(chapterPageUrl(chapter.chapterId)), chapter);
  }
}

export const MVLEMPYR = new MvlempyrExtension();
