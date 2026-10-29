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
  type UpdateManager,
} from "@paperback/types";

import {
  getContentRatings,
  getDeduplicateChapters,
  getHiddenSections,
  getHiddenGroups,
  getHiddenTags,
  getSectionOrder,
  getShowUploadSize,
  getSmallestUpload,
  getTypes,
  ToonkotsuSearchForm,
  ToonkotsuSettingsForm,
} from "./forms";
import {
  DOMAIN,
  PAGE_SIZE,
  READER_BUILD,
  READER_SECRET,
  SECTION_DEFINITIONS,
  SECTIONS,
  SERIES_CACHE_TTL_MS,
  SORT_OPTIONS,
  STATE_KEYS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type FacetsResponse,
  type CachedSeries,
  type LatestResponse,
  type PageMetadata,
  type ReaderKeyResponse,
  type ReaderLimit,
  type SearchMetadata,
  type Series,
  type SeriesListResponse,
  type SeriesResponse,
} from "./models";
import {
  fetchBrowse,
  fetchDiscoveryRanking,
  fetchFacets,
  fetchLatest,
  fetchReadingRanking,
  fetchReaderPage,
  fetchSeries,
  fetchSiteSession,
  requestChapter,
  requestReaderKey,
  ToonkotsuInterceptor,
  type CatalogueParams,
} from "./network";
import {
  fromTagId,
  hasWrappedKeys,
  parseChapterPages,
  parseChapters,
  parseMangaDetails,
  parseMangaIdFromUrl,
  parseRatingId,
  parseReaderKeyResponse,
  parseTagGroups,
  toCarouselItems,
  toFeaturedItems,
  toLatestItems,
  toSearchResults,
} from "./parsers";
import type ToonkotsuConfig from "./pbconfig";
import { captureReaderSecret, deriveReaderKey, signReaderPath, type ReaderKey } from "./utils";

type ReaderSession = { readerKey: ReaderKey; response: ReaderKeyResponse };

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
  private seriesPromise?: { mangaId: string; generation: number; value: Promise<SeriesResponse> };
  private readerKeyPromise?: Promise<ReaderSession | undefined>;
  private siteSessionPromise?: Promise<unknown>;
  private readerSecretPromise?: Promise<string>;
  private readerSecret = READER_SECRET;
  private readerBuild = READER_BUILD;

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
    this.saveCookies(cookies);
    this.invalidateSeries();
    this.facetsPromise = undefined;
    this.readerKeyPromise = undefined;
    this.siteSessionPromise = undefined;
    this.readerSecretPromise = undefined;
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
      .map((id) =>
        id === SECTIONS.GENRES
          ? { ...SECTION_DEFINITIONS[id], title: "" }
          : SECTION_DEFINITIONS[id],
      );
  }

  // The settings' types and hidden tags narrow every catalogue request; pornographic titles are
  // only requested when that rating is on. A hidden tag a search asks for is shown for that search.
  private catalogueParams(
    ratings: string[],
    extraExcluded: string[] = [],
    included: string[] = [],
  ): CatalogueParams {
    const types = getTypes();
    const languages =
      types.length < TYPE_OPTIONS.length
        ? TYPE_OPTIONS.filter(({ id }) => types.includes(id)).flatMap(({ languages }) => languages)
        : [];
    const exclude = [...new Set([...getHiddenTags().map(fromTagId), ...extraExcluded])].filter(
      (tag) => !included.includes(tag),
    );
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

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map(({ id, label }) => ({ id, label }));
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
    const sortId = sortingOption?.id ?? "relevance";
    const sort =
      sortId === "relevance" && !title
        ? "latest"
        : (SORT_OPTIONS.find(({ id }) => id === sortId)?.value ?? "relevance");
    // The site only ever sends whole numbers here, so anything else typed is left out, not sent.
    const whole = (value?: string) => (value && /^\d+$/.test(value) ? Number(value) : undefined);
    const included = genreNames("included");
    const params = this.catalogueParams(ratings, genreNames("excluded"), included);
    const data = await fetchBrowse({
      ...params,
      q: title || undefined,
      originalLanguage: meta.languages?.join(",") || params.originalLanguage,
      genres: included.join(",") || undefined,
      genreMode: meta.genreMode,
      excludeMode: meta.excludeMode,
      demographic: meta.demographics?.join(",") || undefined,
      status:
        meta.statuses
          ?.map((id) => STATUS_OPTIONS.find((option) => option.id === id)?.value ?? id)
          .join(",") || undefined,
      author: meta.author,
      yearFrom: whole(meta.yearFrom),
      yearTo: whole(meta.yearTo),
      chaptersMin: whole(meta.chaptersMin),
      chaptersMax: whole(meta.chaptersMax),
      hasChapters: meta.hasChapters ? "true" : undefined,
      sort,
      // Best Match has no direction. Every other sort takes the Order filter, as on the site, which
      // otherwise starts a title list at A and every other list newest or highest first.
      order: sort === "relevance" ? "desc" : (meta.order ?? (sort === "title" ? "asc" : "desc")),
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
    const [series, facets] = await Promise.all([this.getSeries(mangaId), this.getFacets()]);
    return parseMangaDetails(series, mangaId, facets);
  }

  private getSeries(mangaId: string): Promise<SeriesResponse> {
    // The full series response serves both details and chapters, even across JS contexts.
    const cached = Application.getState(STATE_KEYS.SERIES) as CachedSeries | undefined;
    const generation =
      (Application.getState(STATE_KEYS.SERIES_GENERATION) as number | undefined) ?? 0;
    if (cached?.mangaId === mangaId && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.response);
    }
    if (this.seriesPromise?.mangaId === mangaId && this.seriesPromise.generation === generation) {
      return this.seriesPromise.value;
    }
    const value = fetchSeries(mangaId)
      .then((response) => {
        if (
          this.seriesPromise?.value === value &&
          ((Application.getState(STATE_KEYS.SERIES_GENERATION) as number | undefined) ?? 0) ===
            generation
        ) {
          Application.setState(
            { mangaId, response, expiresAt: Date.now() + SERIES_CACHE_TTL_MS },
            STATE_KEYS.SERIES,
          );
        }
        return response;
      })
      .finally(() => {
        if (this.seriesPromise?.value === value) this.seriesPromise = undefined;
      });
    this.seriesPromise = { mangaId, generation, value };
    return value;
  }

  private invalidateSeries(): void {
    // Requests still running in another JS context must not restore invalidated data.
    const generation =
      (Application.getState(STATE_KEYS.SERIES_GENERATION) as number | undefined) ?? 0;
    Application.setState(generation + 1, STATE_KEYS.SERIES_GENERATION);
    Application.setState(undefined, STATE_KEYS.SERIES);
    this.seriesPromise = undefined;
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await this.getSeries(sourceManga.mangaId), sourceManga, {
      mainOnly: getDeduplicateChapters(),
      showSize: getShowUploadSize(),
      smallest: getSmallestUpload(),
      hiddenGroups: getHiddenGroups(),
    });
  }

  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    const [first] = updateManager.getQueuedItems();
    if (!first) return;
    this.invalidateSeries();
    try {
      await this.getSeries(first.mangaId);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
  }

  private getSiteSession(): Promise<unknown> {
    // The site issues its guest cookie here, and the reader refuses a visitor without one.
    return (this.siteSessionPromise ??= fetchSiteSession().catch((error: unknown) => {
      this.siteSessionPromise = undefined;
      throw error;
    }));
  }

  // Resolves undefined when the site asks for its human check before handing out a key.
  private getReaderKey(): Promise<ReaderSession | undefined> {
    return (this.readerKeyPromise ??= (async () => {
      await this.getSiteSession();
      const { status, data } = await requestReaderKey();
      if (status < 200 || status >= 300) {
        const limit = status === 429 ? (data as ReaderLimit | undefined) : undefined;
        if (needsHumanCheck(limit)) return undefined;
        throw readerError(status, limit, "the reader key");
      }
      const response = parseReaderKeyResponse(data);
      return { readerKey: await deriveReaderKey(response, this.readerSecret), response };
    })().then(
      (session) => {
        if (!session) this.readerKeyPromise = undefined;
        return session;
      },
      (error: unknown) => {
        this.readerKeyPromise = undefined;
        throw error;
      },
    ));
  }

  private saveCookies(cookies: Cookie[]): void {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages = await this.readChapter(chapter.chapterId);
    if (pages) return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    // The check needs the reader to see it, so the chapter is opened in the site's own reader to
    // pass it there, and the session cookie it unlocks is kept.
    throw new CloudflareError({
      url: `${DOMAIN}/chapter/${chapter.chapterId}`,
      method: "GET",
      headers: { "user-agent": await Application.getDefaultUserAgent() },
    });
  }

  // Resolves undefined when the site asks for its human check.
  private async readChapter(chapterId: string): Promise<string[] | undefined> {
    const path = `/api/manga/chapter/${chapterId}`;
    await this.getSiteSession();
    let { status, data } = await requestChapter(path);
    if (status === 401 || status === 403) {
      this.siteSessionPromise = undefined;
      await this.getSiteSession();
      ({ status, data } = await requestChapter(path));
    }
    if (status >= 200 && status < 300 && !hasWrappedKeys(data)) return parseChapterPages(data);
    // A human check or a wait stands however the chapter is asked for; any other refusal, or masked
    // page keys, is answered by signing.
    if (needsHumanCheck(status === 429 ? (data as ReaderLimit | undefined) : undefined)) {
      return undefined;
    }
    return this.readSigned(chapterId, path);
  }

  private async readSigned(chapterId: string, path: string): Promise<string[] | undefined> {
    let recovered: (ReaderSession & { secret: string }) | undefined;
    try {
      for (let attempt = 0; ; attempt++) {
        const session = recovered ?? (await this.getReaderKey());
        if (!session) return undefined;
        const { readerKey, response } = session;
        const { status, data } = await requestChapter(path, await signReaderPath(readerKey, path));
        if (status >= 200 && status < 300) {
          const pages = await parseChapterPages(data, readerKey);
          if (recovered) {
            this.readerSecret = recovered.secret;
            this.readerSecretPromise = undefined;
            this.readerKeyPromise = Promise.resolve({ readerKey, response });
          }
          this.readerBuild = response.build;
          return pages;
        }
        const limit = (status === 429 ? data : undefined) as ReaderLimit | undefined;
        const sessionRejected = status === 401 || status === 403;
        const signingRejected = sessionRejected || limit?.resign === true;
        // Refresh an expired key, and a refused guest session with it, first; only rediscover after
        // a persistent signing/build failure.
        if (attempt === 0 && signingRejected) {
          this.readerKeyPromise = undefined;
          if (sessionRejected) this.siteSessionPromise = undefined;
          continue;
        }
        if (
          attempt === 1 &&
          signingRejected &&
          (limit?.resign || response.build !== this.readerBuild)
        ) {
          const url = `${DOMAIN}/chapter/${chapterId}`;
          const secret = await (this.readerSecretPromise ??= fetchReaderPage(chapterId).then(
            (html) =>
              captureReaderSecret(
                html,
                url,
                response,
                this.cookieStorageInterceptor.cookiesForUrl(url),
              ),
          ));
          recovered = {
            secret,
            response,
            readerKey: { ...(await deriveReaderKey(response, secret)), offset: readerKey.offset },
          };
          continue;
        }
        if (needsHumanCheck(limit)) return undefined;
        throw readerError(
          status,
          limit,
          `chapter ${chapterId}`,
          response.build !== this.readerBuild,
        );
      }
    } catch (error) {
      this.readerSecretPromise = undefined;
      throw error;
    }
  }
}

// Guests are asked to confirm they are human before reading on. A timed limit is reported with its
// wait; any other reading limit is the human check.
const needsHumanCheck = (limit: ReaderLimit | undefined): boolean => {
  if (limit?.code !== "manga-limit" || limit.resign) return false;
  if (limit.transient || limit.reason === "wait") {
    throw new Error(
      `Toonkotsu is limiting reads right now. Try again in ${limit.retryAfterSec || (limit.reason === "wait" ? 600 : 10)} seconds.`,
    );
  }
  return true;
};

const readerError = (
  status: number,
  limit: ReaderLimit | undefined,
  subject: string,
  readerChanged = false,
): Error => {
  const reason = readerChanged
    ? " The site's reader has been updated, so this source needs an update too."
    : "";
  return new Error(
    `Could not load ${subject} (status ${status}${limit?.error ? `: ${limit.error}` : ""}).${reason}`,
  );
};

export const Toonkotsu = new ToonkotsuExtension();
