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
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import {
  getChapterLanguages,
  getContentRatings,
  getHiddenSections,
  getHiddenTags,
  getSectionOrder,
  getTypes,
  ToonkotsuSearchForm,
  ToonkotsuSettingsForm,
} from "./forms";
import {
  DOMAIN,
  PAGE_SIZE,
  READER_BUILD,
  SECTION_DEFINITIONS,
  SECTIONS,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  type ChapterResponse,
  type FacetsResponse,
  type LatestResponse,
  type PageMetadata,
  type ReaderLimit,
  type SearchMetadata,
  type Series,
  type SeriesListResponse,
} from "./models";
import {
  fetchBrowse,
  fetchFacets,
  fetchHome,
  fetchLatest,
  fetchRanking,
  fetchReaderKey,
  fetchSeries,
  requestChapter,
  ToonkotsuInterceptor,
  type CatalogueParams,
} from "./network";
import {
  fromTagId,
  parseChapterPages,
  parseChapters,
  parseGenres,
  parseHomeRow,
  parseMangaDetails,
  parseMangaIdFromUrl,
  parseRatingId,
  toCarouselItems,
  toFeaturedItems,
  toLatestItems,
  toSearchResults,
} from "./parsers";
import type ToonkotsuConfig from "./pbconfig";
import { deriveReaderKey, signReaderPath, type ReaderKey } from "./utils";

type SectionData =
  | { kind: "series"; items: Series[]; hasNext: boolean }
  | { kind: "latest"; items: LatestResponse["items"]; hasNext: boolean };

const hasNextPage = (data: SeriesListResponse, page: number): boolean =>
  data.hasNextPage ??
  (typeof data.total === "number"
    ? page * (data.limit ?? PAGE_SIZE) < data.total
    : data.items.length >= PAGE_SIZE);

class ToonkotsuExtension implements ExtensionImpl<typeof ToonkotsuConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new ToonkotsuInterceptor("main");
  private facetsPromise?: Promise<FacetsResponse>;
  private readerKeyPromise?: Promise<{ readerKey: ReaderKey; build: string }>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  // The reader's limit check is passed in the site's own session, so every cookie is kept, not
  // only the Cloudflare clearance.
  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
    this.facetsPromise = undefined;
    this.readerKeyPromise = undefined;
  }

  private getFacets(): Promise<FacetsResponse> {
    return (this.facetsPromise ??= fetchFacets().catch((error: unknown) => {
      this.facetsPromise = undefined;
      throw error;
    }));
  }

  private async getGenreOptions(): Promise<Tag[]> {
    return parseGenres(await this.getFacets(), getContentRatings().includes("pornographic"));
  }

  async getSettingsForm(): Promise<Form> {
    return new ToonkotsuSettingsForm(parseGenres(await this.getFacets(), true));
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    const hidden = new Set(getHiddenSections());
    return getSectionOrder()
      .filter((id) => !hidden.has(id))
      .map((id) => SECTION_DEFINITIONS[id]);
  }

  // The settings' types and hidden tags narrow every catalogue request; pornographic titles are
  // only requested when that rating is on.
  private catalogueParams(ratings: string[], extraExcluded: string[] = []): CatalogueParams {
    const types = getTypes();
    const languages =
      types.length < TYPE_OPTIONS.length
        ? TYPE_OPTIONS.filter(({ id }) => types.includes(id)).flatMap(({ languages }) => languages)
        : [];
    const exclude = [...new Set([...getHiddenTags().map(fromTagId), ...extraExcluded])];
    return {
      sfw: !ratings.includes("pornographic"),
      originalLanguage: languages.join(",") || undefined,
      exclude: exclude.join(",") || undefined,
    };
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.GENRES) {
      const hidden = new Set(getHiddenTags());
      return {
        items: (await this.getGenreOptions())
          .filter((genre) => !hidden.has(genre.id))
          .map((genre) => ({
            type: "genresCarouselItem",
            name: genre.title,
            searchQuery: { title: "", metadata: { genres: { [genre.id]: "included" } } },
          })),
      };
    }
    const page = metadata?.page ?? 1;
    const ratings = getContentRatings();
    const data = await this.loadSection(section.id, page, this.catalogueParams(ratings));
    const items =
      data.kind === "latest"
        ? toLatestItems(data.items.filter(({ series }) => ratings.includes(parseRatingId(series))))
        : this.toSectionItems(
            section,
            data.items.filter((series) => ratings.includes(parseRatingId(series))),
          );
    return { items, metadata: data.hasNext ? { page: page + 1 } : undefined };
  }

  private toSectionItems(section: DiscoverSection, items: Series[]): DiscoverSectionItem[] {
    switch (section.type) {
      case DiscoverSectionType.featured:
        return toFeaturedItems(items);
      case DiscoverSectionType.prominentCarousel:
        return toCarouselItems(items, "prominentCarouselItem");
      default:
        return toCarouselItems(items, "simpleCarouselItem");
    }
  }

  private async loadSection(
    sectionId: string,
    page: number,
    params: CatalogueParams,
  ): Promise<SectionData> {
    switch (sectionId) {
      case SECTIONS.MOST_READ:
        return {
          kind: "series",
          items: parseHomeRow(await fetchHome(params.sfw === true), "mostread"),
          hasNext: false,
        };
      case SECTIONS.TRENDING:
        return this.browseSection({ ...params, sort: "popular", order: "desc", page }, page);
      case SECTIONS.TRENDING_NOW:
        return this.rankingSection("trending", params, page);
      case SECTIONS.HIDDEN_GEMS:
        return this.rankingSection("gems", params, page);
      case SECTIONS.LATEST: {
        const data = await fetchLatest(page, params);
        return { kind: "latest", items: data.items, hasNext: data.hasNextPage ?? false };
      }
      case SECTIONS.TOP_RATED:
        return this.browseSection({ ...params, sort: "score", order: "desc", page }, page);
      case SECTIONS.RECENTLY_ADDED:
        return this.browseSection({ ...params, sort: "new", order: "desc", page }, page);
      case SECTIONS.THIS_SEASON:
        return this.browseSection({ ...params, discovery: "seasonal", page }, page);
      case SECTIONS.COMPLETED:
        return this.browseSection({ ...params, discovery: "completed", page }, page);
      default:
        return { kind: "series", items: [], hasNext: false };
    }
  }

  private async browseSection(params: CatalogueParams, page: number): Promise<SectionData> {
    const data = await fetchBrowse(params);
    return { kind: "series", items: data.items, hasNext: hasNextPage(data, page) };
  }

  private async rankingSection(
    metric: string,
    params: CatalogueParams,
    page: number,
  ): Promise<SectionData> {
    const data = await fetchRanking(metric, { ...params, discovery: metric, page });
    return { kind: "series", items: data.items, hasNext: hasNextPage(data, page) };
  }

  async getSortingOptions(query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    const options = [SORT_OPTIONS.LATEST, ...SORT_OPTIONS.OTHERS];
    return query.title.trim() ? [SORT_OPTIONS.RELEVANCE, ...options] : options;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new ToonkotsuSearchForm(query, await this.getGenreOptions());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = query.title.trim();
    const pastedId = parseMangaIdFromUrl(title);
    if (pastedId) {
      const manga = await this.getMangaDetails(pastedId);
      return {
        items: [
          {
            mangaId: pastedId,
            title: manga.mangaInfo.primaryTitle,
            imageUrl: manga.mangaInfo.thumbnailUrl,
            contentRating: manga.mangaInfo.contentRating,
          },
        ],
      };
    }
    const meta = query.metadata ?? {};
    const page = metadata?.page ?? 1;
    const ratings = meta.ratings ?? getContentRatings();
    const genres = Object.entries(meta.genres ?? {});
    const genreNames = (state: "included" | "excluded") =>
      genres.filter(([, value]) => value === state).map(([id]) => fromTagId(id));
    const sortId =
      sortingOption?.id ?? (title ? SORT_OPTIONS.RELEVANCE.id : SORT_OPTIONS.LATEST.id);
    // Best Match is the catalogue's default order for a text search and has no sort token.
    const [sort = "", order = "desc"] =
      sortId === SORT_OPTIONS.RELEVANCE.id ? [] : sortId.split("-");
    const params = this.catalogueParams(ratings, genreNames("excluded"));
    const data = await fetchBrowse({
      ...params,
      q: title || undefined,
      originalLanguage: meta.languages?.join(",") || params.originalLanguage,
      genres: genreNames("included").join(",") || undefined,
      genreMode: meta.genreMode,
      excludeMode: meta.excludeMode,
      demographic: meta.demographics?.join(",") || undefined,
      status: meta.statuses?.join(",") || undefined,
      author: meta.author,
      yearFrom: meta.yearFrom,
      yearTo: meta.yearTo,
      chaptersMin: meta.chaptersMin,
      chaptersMax: meta.chaptersMax,
      sort: sort || (title ? undefined : "latest"),
      order,
      page,
    });
    return {
      items: toSearchResults(
        data.items.filter((series) => ratings.includes(parseRatingId(series))),
      ),
      metadata: hasNextPage(data, page) ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchSeries(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(
      await fetchSeries(sourceManga.mangaId),
      sourceManga,
      getChapterLanguages(),
    );
  }

  private getReaderKey(): Promise<{ readerKey: ReaderKey; build: string }> {
    return (this.readerKeyPromise ??= fetchReaderKey()
      .then(async (response) => ({
        readerKey: await deriveReaderKey(response),
        build: response.build,
      }))
      .catch((error: unknown) => {
        this.readerKeyPromise = undefined;
        throw error;
      }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const path = `/api/manga/chapter/${chapter.chapterId}`;
    for (let attempt = 0; ; attempt++) {
      const { readerKey, build } = await this.getReaderKey();
      const { status, data } = await requestChapter(path, await signReaderPath(readerKey, path));
      if (status >= 200 && status < 300) {
        return {
          id: chapter.chapterId,
          mangaId: chapter.sourceManga.mangaId,
          pages: await parseChapterPages(data as ChapterResponse, readerKey),
        };
      }
      const limit = (status === 429 ? data : undefined) as ReaderLimit | undefined;
      // An expired or rotated reading key is refreshed once before giving up.
      if (attempt === 0 && (status === 401 || status === 403 || limit?.resign)) {
        this.readerKeyPromise = undefined;
        continue;
      }
      if (limit?.code === "manga-limit") {
        if (limit.transient) {
          throw new Error(
            `Toonkotsu is limiting reads right now. Try again in ${limit.retryAfterSec ?? 10} seconds.`,
          );
        }
        // The site asks for a human check before more chapters; it is passed on the chapter page.
        throw new CloudflareError({
          url: `${DOMAIN}/title/${chapter.sourceManga.mangaId}/${chapter.chapterId}-chapter-${chapter.chapNum}`,
          method: "GET",
          headers: { "user-agent": await Application.getDefaultUserAgent() },
        });
      }
      const reason =
        build === READER_BUILD
          ? ""
          : " The site's reader has been updated, so this source needs an update too.";
      throw new Error(`Could not load chapter ${chapter.chapterId} (status ${status}).${reason}`);
    }
  }
}

export const Toonkotsu = new ToonkotsuExtension();
