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
  MangaTownAdvancedSearchForm,
  MangaTownSettingsForm,
} from "./forms";
import {
  DEMOGRAPHICS,
  FEATURED_LIMIT,
  READER_CONCURRENCY,
  GENRES,
  HOT_PERIODS,
  SECTION_DEFINITIONS,
  SECTIONS,
  SORT_OPTIONS,
  SORT_TOKENS,
  type MangaListItem,
  type PageMetadata,
  type SearchMetadata,
  type SearchRequest,
} from "./models";
import {
  chapterUrl,
  directoryUrl,
  fetchChapterPage,
  fetchFeaturedPage,
  fetchListingPage,
  fetchMangaPage,
  hotUrl,
  MangaTownInterceptor,
  searchUrl,
} from "./network";
import {
  buildFeaturedItem,
  buildSequentialImageUrls,
  contentRatingForGenres,
  parseChapterPageUrls,
  parseChapters,
  parseHasNextPage,
  parseMangaDetails,
  parseMangaId,
  parseMangaList,
  parseViewerImage,
  parseViewerImages,
  toChapterUpdateItem,
  toTopItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type MangaTownConfig from "./pbconfig";

const GENRE_TITLES = new Map([...GENRES, ...DEMOGRAPHICS].map((tag) => [tag.id, tag.title]));

const triStateValues = (
  genres: SearchMetadata["genres"],
  state: "included" | "excluded",
): string[] =>
  Object.entries(genres ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => id);

class MangaTownExtension implements ExtensionImpl<typeof MangaTownConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new MangaTownInterceptor("main");
  private featuredPromise?: Promise<DiscoverSectionItem[]>;
  private readerCache = new Map<string, string[]>();

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
    this.featuredPromise = undefined;
    this.readerCache.clear();
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
      case SECTIONS.FEATURED:
        return { items: await this.getFeaturedItems() };
      case SECTIONS.HOT:
        return this.getHotSection();
      case SECTIONS.LATEST:
        return this.getListingSection(
          directoryUrl(page, { sortToken: SORT_TOKENS.latest }),
          page,
          (item) => {
            const mapped = toChapterUpdateItem(item);
            return mapped ? [mapped] : [];
          },
        );
      case SECTIONS.NEW:
        return this.getListingSection(directoryUrl(page, { status: "new" }), page, (item) => [
          toSimpleItem(item),
        ]);
      case SECTIONS.ROMANCE:
        return this.getListingSection(
          directoryUrl(page, { genre: "romance", sortToken: SORT_TOKENS.latest }),
          page,
          (item) => [toSimpleItem(item)],
        );
      case SECTIONS.SHOUNEN:
        return this.getListingSection(
          directoryUrl(page, { demographic: "shounen", sortToken: SORT_TOKENS.latest }),
          page,
          (item) => [toSimpleItem(item)],
        );
      case SECTIONS.TOP_SHOUNEN:
        return this.getListingSection(hotUrl(page, "shounen"), page, (item) => [toTopItem(item)]);
      case SECTIONS.SEINEN:
        return this.getListingSection(
          directoryUrl(page, { demographic: "seinen", sortToken: SORT_TOKENS.latest }),
          page,
          (item) => [toSimpleItem(item)],
        );
      case SECTIONS.TOP_SEINEN:
        return this.getListingSection(hotUrl(page, "seinen"), page, (item) => [toTopItem(item)]);
      case SECTIONS.SHOUJO:
        return this.getListingSection(
          directoryUrl(page, { demographic: "shoujo", sortToken: SORT_TOKENS.latest }),
          page,
          (item) => [toSimpleItem(item)],
        );
      case SECTIONS.TOP_SHOUJO:
        return this.getListingSection(hotUrl(page, "shoujo"), page, (item) => [toTopItem(item)]);
      case SECTIONS.YAOI:
        return this.getListingSection(directoryUrl(page, { demographic: "yaoi" }), page, (item) => [
          toSimpleItem(item),
        ]);
      case SECTIONS.SHOUNEN_AI:
        return this.getListingSection(
          directoryUrl(page, { demographic: "shounen_ai" }),
          page,
          (item) => [toSimpleItem(item)],
        );
      case SECTIONS.JOSEI:
        return this.getListingSection(
          directoryUrl(page, { demographic: "josei" }),
          page,
          (item) => [toSimpleItem(item)],
        );
      case SECTIONS.TOP_YAOI:
        return this.getListingSection(hotUrl(page, "yaoi"), page, (item) => [toTopItem(item)]);
      case SECTIONS.GENRES:
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  private async getFeaturedItems(): Promise<DiscoverSectionItem[]> {
    const request = (this.featuredPromise ??= this.buildFeaturedItems());
    try {
      return await request;
    } catch (error) {
      if (this.featuredPromise === request) this.featuredPromise = undefined;
      throw error;
    }
  }

  // The featured listing carries no author, so each card is
  // completed from its details page, capped at FEATURED_LIMIT titles.
  private async buildFeaturedItems(): Promise<DiscoverSectionItem[]> {
    const cards = parseMangaList(await fetchFeaturedPage()).slice(0, FEATURED_LIMIT);
    return Promise.all(
      cards.map(async (card): Promise<DiscoverSectionItem> => {
        try {
          const manga = await this.getMangaDetails(card.mangaId);
          return buildFeaturedItem(
            {
              ...card,
              rating:
                card.rating ??
                (manga.mangaInfo.rating != null ? manga.mangaInfo.rating * 5 : undefined),
              genres:
                card.genres.length > 0
                  ? card.genres
                  : (manga.mangaInfo.tagGroups?.[0]?.tags.map((tag) => tag.title) ?? []),
            },
            manga.mangaInfo.author,
          );
        } catch (error) {
          if (error instanceof CloudflareError) throw error;
          return buildFeaturedItem(card);
        }
      }),
    );
  }

  private async getHotSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: HOT_PERIODS.map((period) => ({
        type: "genresCarouselItem",
        name: period.title,
        searchQuery: {
          title: "",
          metadata: { hotPeriod: period.id } satisfies SearchMetadata,
        },
      })),
    };
  }

  private async getGenreSection(): Promise<PagedResults<DiscoverSectionItem>> {
    return {
      items: GENRES.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
        },
        contentRating: contentRatingForGenres([genre.title]),
      })),
    };
  }

  private async getListingSection(
    url: string,
    page: number,
    mapper: (item: MangaListItem) => DiscoverSectionItem[],
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const $ = await fetchListingPage(url);
    return {
      items: parseMangaList($).flatMap(mapper),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MangaTownAdvancedSearchForm(query);
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaTownSettingsForm();
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
      demographic: [],
      completed: [],
      author: "",
      artist: "",
    };

    if (searchMetadata.hotPeriod) {
      const token = HOT_PERIODS.find((period) => period.id === searchMetadata.hotPeriod)?.token;
      return this.getSearchListing(hotUrl(page, undefined, token || undefined), page);
    }

    const name = query.title.trim();
    const author = searchMetadata.author?.trim();
    const artist = searchMetadata.artist?.trim();
    const includedSlugs = triStateValues(searchMetadata.genres, "included");
    const excludedSlugs = triStateValues(searchMetadata.genres, "excluded");
    const demographic = searchMetadata.demographic?.[0];
    const completed = searchMetadata.completed?.[0];

    // The directory handles every single-genre browse and is the only listing
    // with ordering controls; the search endpoint covers everything else.
    if (!name && !author && !artist && includedSlugs.length <= 1 && excludedSlugs.length === 0) {
      const url = directoryUrl(page, {
        demographic,
        genre: includedSlugs[0],
        status: completed,
        sortToken: SORT_TOKENS[sortingOption?.id ?? SORT_OPTIONS[0].id] || undefined,
      });
      return this.getSearchListing(url, page);
    }

    const request: SearchRequest = {
      name: name || undefined,
      author: author || undefined,
      artist: artist || undefined,
      includedGenres: includedSlugs.map((slug) => GENRE_TITLES.get(slug) ?? slug),
      excludedGenres: excludedSlugs.map((slug) => GENRE_TITLES.get(slug) ?? slug),
      demographic: demographic ? GENRE_TITLES.get(demographic) : undefined,
      isCompleted: completed === "completed" ? "1" : completed === "ongoing" ? "0" : undefined,
    };
    return this.getSearchListing(searchUrl(page, request), page);
  }

  private async getSearchListing(
    url: string,
    page: number,
  ): Promise<PagedResults<SearchResultItem>> {
    const $ = await fetchListingPage(url);
    return {
      items: parseMangaList($).map(toSearchResultItem),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const url = query
      .trim()
      .match(/^https?:\/\/(?:www\.|m\.)?mangatown\.com\/manga\/[^/?#]+\/?$/i)?.[0];
    if (!url) return undefined;
    const mangaId = parseMangaId(url);
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
    return parseMangaDetails(await fetchMangaPage(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchMangaPage(sourceManga.mangaId), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;
    const cached = this.readerCache.get(chapter.chapterId);
    if (cached) return { id: chapter.chapterId, mangaId, pages: cached };

    const $ = await fetchChapterPage(chapterUrl(mangaId, chapter.chapterId));
    const pageUrls = parseChapterPageUrls($);

    // Paged chapters expose one image per page, so every remaining page is
    // fetched to collect its image; long-strip chapters list them all at once.
    const pages =
      pageUrls.length > 0 ? await this.readPagedChapter($, pageUrls) : parseViewerImages($);

    const validPages = pages.filter((url) => url.length > 0);
    if (validPages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId} of ${mangaId}.`);
    }
    // Rebuilding this costs one request per page, so keep a complete result for
    // the session; a partial one is left out so reopening retries the gaps.
    if (validPages.length === pages.length) {
      this.readerCache.set(chapter.chapterId, validPages);
    }
    return { id: chapter.chapterId, mangaId, pages: validPages };
  }

  // A chapter's images are numbered sequentially in one directory, so the list
  // can be derived from page one instead of fetching every page. The last page
  // is still read to confirm the derived list lines up before it is trusted.
  private async readPagedChapter(firstPage: CheerioAPI, pageUrls: string[]): Promise<string[]> {
    const firstImage = parseViewerImage(firstPage);
    if (pageUrls.length === 1) return [firstImage];

    const derived = firstImage
      ? buildSequentialImageUrls(firstImage, 1, pageUrls.length)
      : undefined;
    if (derived) {
      const lastImage = await this.fetchPageImage(pageUrls[pageUrls.length - 1]);
      if (lastImage && lastImage === derived[derived.length - 1]) return derived;
    }

    return this.fetchPageImages(firstPage, pageUrls);
  }

  // Fallback for chapters whose images are not sequentially numbered: each page
  // holds a single image, so a small worker pool keeps the order while capping
  // how many of those requests are in flight at once.
  private async fetchPageImages(firstPage: CheerioAPI, pageUrls: string[]): Promise<string[]> {
    const images: string[] = Array.from({ length: pageUrls.length }, () => "");
    images[0] = parseViewerImage(firstPage);

    let cursor = 1;
    const worker = async (): Promise<void> => {
      while (cursor < pageUrls.length) {
        const index = cursor++;
        images[index] = await this.fetchPageImage(pageUrls[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(READER_CONCURRENCY, pageUrls.length - 1) }, worker),
    );
    return images;
  }

  // One page failing shouldn't sink the whole chapter, so a miss leaves its slot
  // empty and the chapter opens without it.
  private async fetchPageImage(pageUrl: string): Promise<string> {
    try {
      return parseViewerImage(await fetchChapterPage(pageUrl));
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return "";
    }
  }
}

export const MangaTown = new MangaTownExtension();
