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
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type ChapterResponse,
  type FacetsResponse,
  type LatestResponse,
  type PageMetadata,
  type ReaderKeyResponse,
  type ReaderLimit,
  type SearchMetadata,
  type Series,
  type SeriesListResponse,
} from "./models";
import {
  fetchBrowse,
  fetchDiscoveryRanking,
  fetchFacets,
  fetchLatest,
  fetchReadingRanking,
  fetchSeries,
  requestChapter,
  requestReaderKey,
  ToonkotsuInterceptor,
  type CatalogueParams,
} from "./network";
import {
  fromTagId,
  parseChapterPages,
  parseChapters,
  parseMangaDetails,
  parseMangaIdFromUrl,
  parseRatingId,
  parseTagGroups,
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

  async getSettingsForm(): Promise<Form> {
    const groups = parseTagGroups(await this.getFacets(), ["pornographic"]);
    return new ToonkotsuSettingsForm(
      groups.flatMap(({ tags }) => tags).sort((a, b) => a.title.localeCompare(b.title)),
    );
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
      const genres = parseTagGroups(await this.getFacets(), getContentRatings()).find(
        ({ id }) => id === "genres",
      );
      return {
        items: (genres?.tags ?? [])
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
    const allowed = (series: Series) => ratings.includes(parseRatingId(series));
    let items: DiscoverSectionItem[];
    const seen = new Set(metadata?.seen ?? []);
    if (data.kind === "latest") {
      // The feed lists every new chapter, but the site shows each title once, at its newest.
      items = toLatestItems(
        data.items.filter(({ series }) => {
          if (seen.has(series.id)) return false;
          seen.add(series.id);
          return allowed(series);
        }),
      );
    } else if (section.type === DiscoverSectionType.featured) {
      // Ranks are the site's positions, so a title hidden by the settings leaves its number unused.
      items = toFeaturedItems(
        data.items.flatMap((series, index) =>
          allowed(series) ? [{ series, rank: (page - 1) * PAGE_SIZE + index + 1 }] : [],
        ),
      );
    } else {
      items = toCarouselItems(
        data.items.filter(allowed),
        section.type === DiscoverSectionType.prominentCarousel
          ? "prominentCarouselItem"
          : "simpleCarouselItem",
      );
    }
    return {
      items,
      metadata: data.hasNext
        ? { page: page + 1, ...(data.kind === "latest" && { seen: [...seen] }) }
        : undefined,
    };
  }

  private async loadSection(
    sectionId: string,
    page: number,
    params: CatalogueParams,
  ): Promise<SectionData> {
    switch (sectionId) {
      case SECTIONS.MOST_READ:
      case SECTIONS.TRENDING: {
        const data = await fetchReadingRanking(
          sectionId === SECTIONS.TRENDING ? "trending" : "views",
          {
            ...params,
            sort: "latest",
            order: "desc",
            page,
          },
        );
        return { kind: "series", items: data.items, hasNext: hasNextPage(data, page) };
      }
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
    const data = await fetchDiscoveryRanking(metric, { ...params, page });
    return { kind: "series", items: data.items, hasNext: hasNextPage(data, page) };
  }

  async getSortingOptions(query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    const options = [SORT_OPTIONS.LATEST, ...SORT_OPTIONS.OTHERS];
    return query.title.trim() ? [SORT_OPTIONS.RELEVANCE, ...options] : options;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new ToonkotsuSearchForm(
      query,
      parseTagGroups(await this.getFacets(), query.metadata?.ratings ?? getContentRatings()),
    );
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = query.title.trim();
    const pastedId = parseMangaIdFromUrl(title);
    if (pastedId) {
      try {
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
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        // URL lookup is optional; unresolved links continue through ordinary search.
      }
    }
    const meta = query.metadata ?? {};
    const page = metadata?.page ?? 1;
    const ratings = meta.ratings ?? getContentRatings();
    const genres = Object.entries(meta.genres ?? {});
    const genreNames = (state: "included" | "excluded") =>
      genres.filter(([, value]) => value === state).map(([id]) => fromTagId(id));
    // Best Match ranks by the text query, so without one the site's default order applies.
    const sortId =
      sortingOption?.id === SORT_OPTIONS.RELEVANCE.id && !title
        ? SORT_OPTIONS.LATEST.id
        : (sortingOption?.id ?? (title ? SORT_OPTIONS.RELEVANCE.id : SORT_OPTIONS.LATEST.id));
    const [sort, order = "desc"] = sortId.split("-");
    const params = this.catalogueParams(ratings, genreNames("excluded"));
    const data = await fetchBrowse({
      ...params,
      q: title || undefined,
      originalLanguage: meta.languages?.join(",") || params.originalLanguage,
      genres: genreNames("included").join(",") || undefined,
      genreMode: meta.genreMode,
      excludeMode: meta.excludeMode,
      demographic: meta.demographics?.join(",") || undefined,
      status:
        meta.statuses
          ?.map((id) => STATUS_OPTIONS.find((option) => option.id === id)?.value ?? id)
          .join(",") || undefined,
      author: meta.author,
      yearFrom: meta.yearFrom,
      yearTo: meta.yearTo,
      chaptersMin: meta.chaptersMin,
      chaptersMax: meta.chaptersMax,
      sort,
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
    const [series, facets] = await Promise.all([fetchSeries(mangaId), this.getFacets()]);
    return parseMangaDetails(series, mangaId, facets);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(
      await fetchSeries(sourceManga.mangaId),
      sourceManga,
      getChapterLanguages(),
    );
  }

  private getReaderKey(chapterId: string): Promise<{ readerKey: ReaderKey; build: string }> {
    return (this.readerKeyPromise ??= requestReaderKey()
      .then(async ({ status, data }) => {
        if (status < 200 || status >= 300) {
          throw await readerError(status, data as ReaderLimit | undefined, chapterId);
        }
        const response = data as ReaderKeyResponse;
        return { readerKey: await deriveReaderKey(response), build: response.build };
      })
      .catch((error: unknown) => {
        this.readerKeyPromise = undefined;
        throw error;
      }));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const path = `/api/manga/chapter/${chapter.chapterId}`;
    for (let attempt = 0; ; attempt++) {
      const { readerKey, build } = await this.getReaderKey(chapter.chapterId);
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
      throw await readerError(status, limit, chapter.chapterId, build);
    }
  }
}

// Guests are asked to confirm they are human before reading on. The check runs in the site's own
// reader, so the chapter is opened there and the session cookie it unlocks is kept.
const readerError = async (
  status: number,
  limit: ReaderLimit | undefined,
  chapterId: string,
  build = READER_BUILD,
): Promise<Error> => {
  if (limit?.code === "manga-limit" && (limit.transient || limit.reason === "wait")) {
    return new Error(
      `Toonkotsu is limiting reads right now. Try again in ${limit.retryAfterSec || (limit.reason === "wait" ? 600 : 10)} seconds.`,
    );
  }
  if (limit?.code === "manga-limit") {
    return new CloudflareError({
      url: `${DOMAIN}/chapter/${chapterId}`,
      method: "GET",
      headers: { "user-agent": await Application.getDefaultUserAgent() },
    });
  }
  const reason =
    build === READER_BUILD
      ? ""
      : " The site's reader has been updated, so this source needs an update too.";
  return new Error(
    `Could not load chapter ${chapterId} (status ${status}${limit?.error ? `: ${limit.error}` : ""}).${reason}`,
  );
};

export const Toonkotsu = new ToonkotsuExtension();
