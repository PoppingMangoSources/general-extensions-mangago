/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
  CookieStorageInterceptor,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type FeaturedCarouselItem,
  type Form,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  getDiscoverStatus,
  getDiscoverType,
  getExcludedGenres,
  getSectionsOrder,
  getShowNsfw,
  OnisagaAdvancedSearchForm,
  OnisagaSettingsForm,
} from "./forms";
import {
  buildBrowseRequest,
  buildLoadMoreChaptersRequest,
  buildSectionToggleRequest,
  defaultUpdates,
  extractLivewireState,
  isDefaultUpdates,
} from "./livewire";
import {
  DEFAULT_SORT,
  DOMAIN,
  GENRES,
  SECTION_TOGGLES,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  type LivewireResponse,
  type LivewireState,
  type OnisagaSearchMetadata,
  type PageApiResponse,
  type PostFilterUpdates,
} from "./models";
import { livewireHeaders, OnisagaInterceptor } from "./network";
import {
  buildStatSubtitle,
  countPages,
  extractReaderToken,
  hasNextPage,
  mangaIdFromHref,
  parseChapters,
  parseJson,
  parseMangaCards,
  parseMangaDetails,
  parseTopManga,
  straightenQuotes,
  topMangaSubtitle,
  type MangaCard,
  type TopMangaItem,
} from "./parsers";
import type OnisagaConfig from "./pbconfig";

// How many ranked titles the featured hero shows. Each one costs a detail-page
// lookup to fetch its author + synopsis, so keep this bounded.
const FEATURED_LIMIT = 10;

// Carousel style per discover rail id (the user can reorder/hide rails, but the
// style is fixed by what each rail renders best as). Rails with an on-site toggle
// render as chip rows (Day/Week/Month, platform, …) — MangaDot's pattern.
function discoverSectionType(id: string): DiscoverSectionType {
  if (SECTION_TOGGLES[id]) return DiscoverSectionType.genres;
  switch (id) {
    case "top_manga":
      return DiscoverSectionType.featured;
    case "highest_rated":
      return DiscoverSectionType.prominentCarousel;
    case "genres":
    case "types":
      return DiscoverSectionType.genres;
    default:
      return DiscoverSectionType.simpleCarousel;
  }
}

// Featured hero stat pills from a top-manga ranking row: ★ rating and a flame
// read-count, each shown only when the row carried it.
function topMangaInfoItems(item: TopMangaItem): FeaturedCarouselItem["infoItems"] {
  const pills: { symbol: string; text: string }[] = [];
  if (item.rating) pills.push({ symbol: "star.fill", text: item.rating });
  if (item.reads) pills.push({ symbol: "flame.fill", text: item.reads });
  if (pills.length === 0) return undefined;
  return (
    pills.length === 1 ? [pills[0]] : [pills[0], pills[1]]
  ) as FeaturedCarouselItem["infoItems"];
}

export class OnisagaExtension implements ExtensionImpl<typeof OnisagaConfig> {
  requestManager = new OnisagaInterceptor("onisaga-request");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  // The server advertises X-Ratelimit-Limit: 300, so a brisk client cap keeps
  // concurrent page resolution fast while staying well clear of throttling.
  globalRateLimiter = new BasicRateLimiter("onisaga-rate-limiter", {
    numberOfRequests: 10,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // Cached Livewire `post-filter` state (token + snapshot) for the active browse
  // URL, refreshed lazily; shared across the discover sections that all hit /browse.
  private browseStateCache?: { url: string; state: LivewireState; at: number };
  private static readonly BROWSE_STATE_TTL = 60_000;

  // Cached server-rendered home document, shared by the home-sourced rails.
  private homeHtmlCache?: { html: string; at: number };
  private static readonly HOME_TTL = 60_000;

  async initialise(): Promise<void> {
    this.cookieStorageInterceptor.registerInterceptor();
    this.requestManager.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  async getSettingsForm(): Promise<Form> {
    return new OnisagaSettingsForm();
  }

  async getAdvancedSearchForm(
    query: SearchQuery<OnisagaSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new OnisagaAdvancedSearchForm(query);
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.title }));
  }

  // =============================== Discover ====================================

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return getSectionsOrder().map((section) => ({
      id: section.id,
      title: section.title,
      type: discoverSectionType(section.id),
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // Toggle rails render as chip rows; each chip carries the rail + option in its
    // search metadata so a tap runs the ranged fetch through getSearchResults.
    const toggle = SECTION_TOGGLES[section.id];
    if (toggle) {
      return {
        items: toggle.options.map((option) => ({
          type: "genresCarouselItem",
          searchQuery: {
            title: "",
            metadata: {
              toggleSection: section.id,
              toggleValue: option.id,
            } satisfies OnisagaSearchMetadata,
          },
          name: option.title,
        })),
      };
    }

    switch (section.id) {
      case "top_manga":
        return this.getTopMangaFeatured();
      case "latest":
        return this.browseDiscover(DEFAULT_SORT, metadata, (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        }));
      case "highest_rated": {
        const items = await this.fetchTopManga("rated");
        return {
          items: items.map((item) => ({
            type: "prominentCarouselItem",
            mangaId: item.mangaId,
            imageUrl: item.imageUrl,
            title: item.title,
            subtitle: topMangaSubtitle(item),
            contentRating: item.contentRating,
          })),
        };
      }
      case "genres":
        return {
          items: GENRES.map((genre) => ({
            type: "genresCarouselItem",
            searchQuery: {
              title: "",
              metadata: { genres: { [genre.id]: "included" } } satisfies OnisagaSearchMetadata,
            },
            name: genre.title,
          })),
        };
      case "types":
        return {
          items: TYPE_OPTIONS.filter((t) => t.id).map((type) => ({
            type: "genresCarouselItem",
            searchQuery: {
              title: "",
              metadata: { type: type.id } satisfies OnisagaSearchMetadata,
            },
            name: type.title,
          })),
        };
      default:
        return { items: [] };
    }
  }

  private async browseDiscover(
    sort: string,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
    map: (card: MangaCard) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.collectedIds ?? [];

    const updates = defaultUpdates();
    updates.sort = sort;
    updates.platform = getDiscoverType();
    updates.status = getDiscoverStatus();
    updates.excludeGenre = getExcludedGenres();

    const { cards, hasNext } = await this.fetchBrowse(`${DOMAIN}/browse`, updates, page);
    const fresh = cards.filter((card) => !collectedIds.includes(card.mangaId));
    collectedIds.push(...fresh.map((card) => card.mangaId));

    return {
      items: fresh.map(map),
      metadata: hasNext ? { page: page + 1, collectedIds } : undefined,
    };
  }

  // Featured hero: the most-read ranking, enriched with author + synopsis. The
  // ranking page carries no author/description, so the top few are looked up on
  // their detail pages (capped to keep the request count bounded). Enrichment is
  // best-effort — a failed lookup just drops the author/summary for that item.
  private async getTopMangaFeatured(): Promise<PagedResults<DiscoverSectionItem>> {
    const items = (await this.fetchTopManga("reads")).slice(0, FEATURED_LIMIT);

    const enriched = await Promise.all(
      items.map(async (item) => {
        try {
          const $ = await this.fetchCheerio({
            url: `${DOMAIN}/manga/${item.mangaId}`,
            method: "GET",
          });
          const info = parseMangaDetails($, item.mangaId).mangaInfo;
          return { item, author: info.author, summary: info.synopsis };
        } catch {
          return { item, author: undefined, summary: undefined };
        }
      }),
    );

    return {
      items: enriched.map(({ item, author, summary }) => ({
        type: "featuredCarouselItem",
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        supertitle: author || item.genres,
        summary: summary || undefined,
        infoItems: topMangaInfoItems(item),
        contentRating: item.contentRating,
      })),
    };
  }

  // The /top-manga ranking page sorts every title by total reads (?sort=reads)
  // or by rating (?sort=rated). Its rows carry the read count and ★ rating that
  // /browse cards lack, so the featured hero and Highest Rated carousel use it.
  // Best-effort: a changed/empty page yields no items rather than an error.
  private async fetchTopManga(sort: "reads" | "rated"): Promise<TopMangaItem[]> {
    const showNsfw = getShowNsfw();
    try {
      const $ = await this.fetchCheerio({ url: `${DOMAIN}/top-manga?sort=${sort}`, method: "GET" });
      return parseTopManga($, showNsfw);
    } catch {
      return [];
    }
  }

  // The /trending page server-renders every curated rail (Most Popular, Fan
  // Favorites, Top 10 Rising, Trending by Platform, More Trending) eagerly in one
  // document, whereas /home lazy-loads the lower rails via Livewire (so a plain
  // fetch misses them). Pull /trending once and slice each rail out by heading.
  private async fetchHomeHtml(): Promise<string> {
    const now = Date.now();
    const cached = this.homeHtmlCache;
    if (cached && now - cached.at < OnisagaExtension.HOME_TTL) return cached.html;

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/trending`,
      method: "GET",
    });
    const html = Application.arrayBufferToUTF8String(buffer);
    this.homeHtmlCache = { html, at: now };
    return html;
  }

  // A discover toggle chip was tapped: drive the rail's Livewire method
  // (setPeriod / setSort / setPlatform) on /trending and return the re-rendered
  // cards. Best-effort: a missing component/HTML yields no results, not an error.
  private async getToggledSection(
    sectionId: string,
    value: string,
  ): Promise<PagedResults<SearchResultItem>> {
    const toggle = SECTION_TOGGLES[sectionId];
    if (!toggle) return { items: [] };

    try {
      const trendingUrl = `${DOMAIN}/trending`;
      const $ = cheerio.load(await this.fetchHomeHtml());
      const state = extractLivewireState($, toggle.component);
      if (!state) return { items: [] };

      const [, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/livewire/update`,
        method: "POST",
        headers: livewireHeaders(trendingUrl),
        body: JSON.stringify(buildSectionToggleRequest(state, toggle.method, value)),
      });
      const json = parseJson<LivewireResponse>(
        Application.arrayBufferToUTF8String(buffer),
        "livewire toggle",
      );
      const html = json.components?.[0]?.effects?.html;
      const cards = html ? parseMangaCards(cheerio.load(html), getShowNsfw()) : [];

      return {
        items: cards.map((card) => ({
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          contentRating: card.contentRating,
        })),
      };
    } catch {
      return { items: [] };
    }
  }

  // ================================ Search =====================================

  async getSearchResults(
    query: SearchQuery<OnisagaSearchMetadata>,
    metadata: { page?: number } | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    // A discover toggle chip routes here with no title — fetch its ranged cards.
    if (query.metadata?.toggleSection) {
      return this.getToggledSection(query.metadata.toggleSection, query.metadata.toggleValue ?? "");
    }

    const title = straightenQuotes(query.title ?? "").trim();

    if (title.startsWith("http")) {
      const direct = await this.resolveDirectUrl(title);
      if (direct) return { items: [direct] };
    }

    const page = metadata?.page ?? 1;
    const baseUrl = title ? `${DOMAIN}/search/${encodeURIComponent(title)}` : `${DOMAIN}/browse`;
    const updates = this.searchUpdates(query.metadata ?? {}, sortingOption?.id);

    const { cards, hasNext } = await this.fetchBrowse(baseUrl, updates, page);

    return {
      items: cards.map((card) => ({
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        contentRating: card.contentRating,
      })),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private searchUpdates(meta: OnisagaSearchMetadata, sortId?: string): PostFilterUpdates {
    const updates = defaultUpdates();
    updates.sort = sortId || meta.sort || DEFAULT_SORT;
    updates.platform = meta.type ?? "";
    updates.status = meta.status ?? "";
    updates.min_chapters = meta.minChapters ?? "";

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [id, value] of Object.entries(meta.genres ?? {})) {
      if (value === "included") included.push(id);
      else if (value === "excluded") excluded.push(id);
    }
    updates.genre = included;
    updates.excludeGenre = [...new Set([...excluded, ...getExcludedGenres()])];

    return updates;
  }

  private async resolveDirectUrl(rawUrl: string): Promise<SearchResultItem | undefined> {
    let mangaUrl = rawUrl;
    if (/\/read\//.test(rawUrl)) {
      const $ = await this.fetchCheerio({ url: rawUrl, method: "GET" });
      const href = $("a[href*='/manga/']").first().attr("href");
      if (href) mangaUrl = href;
    }

    const mangaId = mangaIdFromHref(mangaUrl);
    if (!mangaId) return undefined;

    const $ = await this.fetchCheerio({ url: `${DOMAIN}/manga/${mangaId}`, method: "GET" });
    const details = parseMangaDetails($, mangaId);
    return {
      mangaId,
      title: details.mangaInfo.primaryTitle,
      imageUrl: details.mangaInfo.thumbnailUrl ?? "",
      contentRating: details.mangaInfo.contentRating ?? ContentRating.EVERYONE,
    };
  }

  // ============================ Manga & Chapters ===============================

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetchCheerio({ url: `${DOMAIN}/manga/${mangaId}`, method: "GET" });
    return parseMangaDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaUrl = `${DOMAIN}/manga/${sourceManga.mangaId}`;
    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });

    let chapters = parseChapters($, sourceManga);

    // The chapter list is paginated client-side; one Livewire call that bumps the
    // loaded-counts past any real series returns the whole list at once.
    const state = extractLivewireState($, "manga.chapter-list");
    if (state) {
      try {
        const [, buffer] = await Application.scheduleRequest({
          url: `${DOMAIN}/livewire/update`,
          method: "POST",
          headers: livewireHeaders(mangaUrl),
          body: JSON.stringify(buildLoadMoreChaptersRequest(state)),
        });
        const json = parseJson<LivewireResponse>(
          Application.arrayBufferToUTF8String(buffer),
          "livewire chapters",
        );
        const html = json.components?.[0]?.effects?.html;
        if (html) {
          const full = parseChapters(cheerio.load(html), sourceManga);
          if (full.length > chapters.length) chapters = full;
        }
      } catch {
        // Keep the first server-rendered page if the bulk load fails.
      }
    }

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    chapters.forEach((chapter, index) => {
      chapter.sortingIndex = index;
    });
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = `${DOMAIN}${chapter.chapterId}`;
    const segments = chapter.chapterId.split("/").filter(Boolean);
    const cid = segments[segments.length - 1];

    const [, buffer] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
    const body = Application.arrayBufferToUTF8String(buffer);

    const token = extractReaderToken(body);
    if (!token) throw new Error("Could not find reader token on chapter page");

    const pageCount = countPages(body);
    if (pageCount === 0) throw new Error("No pages found in chapter");

    // The reader token is per-chapter, not per-page (no rotating token), so every
    // page resolves with the same token — fire them all at once and let the global
    // rate limiter pace the requests. Paperback needs all page URLs up front.
    const resolved = await Promise.all(
      Array.from({ length: pageCount }, (_, order) =>
        this.resolvePageUrl(cid, order, chapterUrl, token),
      ),
    );
    const pages = resolved.filter((url): url is string => url.length > 0);
    if (pages.length === 0) throw new Error("Could not resolve any chapter pages");

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // Resolve a single page's signed CDN url from the tokenized page API. The token
  // is stable for the chapter; retry on a 429 throttle. Returns "" when a page
  // can't be resolved (e.g. a count overshoot) so one bad page never fails the
  // whole chapter.
  private async resolvePageUrl(
    cid: string,
    order: number,
    chapterUrl: string,
    token: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const [response, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/api/chapter/${cid}/page/${order}`,
        method: "GET",
        headers: {
          "X-Reader-Token": token,
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          Referer: chapterUrl,
        },
      });

      if (response.status === 429) {
        const retryAfter = Number(response.headers?.["retry-after"]);
        await Application.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2);
        continue;
      }

      try {
        const dto = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as PageApiResponse;
        return dto.url ?? "";
      } catch {
        return "";
      }
    }

    return "";
  }

  // ============================== Livewire browse ==============================

  private async fetchBrowse(
    baseUrl: string,
    updates: PostFilterUpdates,
    page: number,
  ): Promise<{ cards: MangaCard[]; hasNext: boolean }> {
    const showNsfw = getShowNsfw();

    // Page 1 with default filters: the server-rendered HTML already holds the
    // first batch, so skip the Livewire round-trip.
    if (page === 1 && isDefaultUpdates(updates)) {
      const $ = await this.fetchCheerio({ url: baseUrl, method: "GET" });
      const state = extractLivewireState($, "post-filter");
      if (state) this.browseStateCache = { url: baseUrl, state, at: Date.now() };
      return { cards: parseMangaCards($, showNsfw), hasNext: hasNextPage($) };
    }

    const state = await this.resolveBrowseState(baseUrl);
    if (!state) return { cards: [], hasNext: false };

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/livewire/update`,
      method: "POST",
      headers: livewireHeaders(baseUrl),
      body: JSON.stringify(buildBrowseRequest(state, updates, page)),
    });

    const json = parseJson<LivewireResponse>(
      Application.arrayBufferToUTF8String(buffer),
      "livewire browse",
    );
    const html = json.components?.[0]?.effects?.html;
    if (!html) {
      this.browseStateCache = undefined;
      return { cards: [], hasNext: false };
    }

    const newSnapshot = json.components?.[0]?.snapshot;
    if (newSnapshot) {
      this.browseStateCache = {
        url: baseUrl,
        state: { token: state.token, snapshot: newSnapshot },
        at: Date.now(),
      };
    }

    const $ = cheerio.load(html);
    return { cards: parseMangaCards($, showNsfw), hasNext: hasNextPage($) };
  }

  private async resolveBrowseState(baseUrl: string): Promise<LivewireState | undefined> {
    const now = Date.now();
    const cached = this.browseStateCache;
    if (cached && cached.url === baseUrl && now - cached.at < OnisagaExtension.BROWSE_STATE_TTL) {
      return cached.state;
    }

    const $ = await this.fetchCheerio({ url: baseUrl, method: "GET" });
    const state = extractLivewireState($, "post-filter");
    if (state) this.browseStateCache = { url: baseUrl, state, at: now };
    return state;
  }

  async fetchCheerio(request: Request): Promise<cheerio.CheerioAPI> {
    const [, data] = await Application.scheduleRequest(request);
    return cheerio.load(Application.arrayBufferToUTF8String(data));
  }
}

export const Onisaga = new OnisagaExtension();
