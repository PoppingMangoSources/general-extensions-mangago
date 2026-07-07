/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
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
  getDedupeChapters,
  getDiscoverStatus,
  getDiscoverType,
  getExcludedGenres,
  getLanguages,
  getSectionsOrder,
  getShowNsfw,
  OniSagaAdvancedSearchForm,
  OniSagaSettingsForm,
} from "./forms";
import {
  DEFAULT_SORT,
  DOMAIN,
  SECTION_TOGGLES,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  type LivewireResponse,
  type LivewireState,
  type OniSagaSearchMetadata,
  type PostFilterUpdates,
} from "./models";
import { OniSagaInterceptor, OniSagaPageRateLimiter } from "./network";
import {
  CARD_PARSE_CAP,
  buildStatSubtitle,
  componentHtmlByName,
  countPages,
  extractPageOrders,
  extractReaderToken,
  hasNextPageFromHtml,
  parseChapters,
  parseAnchorCards,
  parseHomeRail,
  parseMangaCards,
  parseMangaCardsFromHtml,
  parseMangaDetails,
  parseTopManga,
  topMangaSubtitle,
  type MangaCard,
  type TopMangaItem,
} from "./parsers";
import type OniSagaConfig from "./pbconfig";
import {
  getGenres,
  mangaIdFromHref,
  normalizeReleaseDate,
  parseJson,
  straightenQuotes,
} from "./utils/helpers";
import {
  buildBrowseRequest,
  buildLoadMoreChaptersRequest,
  buildSectionToggleRequest,
  defaultUpdates,
  extractLivewireState,
  extractLivewireStateFromHtml,
  livewireHeaders,
} from "./utils/livewire";

const FEATURED_LIMIT = 10;

// The browse/search Livewire component renders this many cards per page.
const BROWSE_PAGE_SIZE = 24;

// Carousel style per rail; toggle rails render as chip rows.
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

function toSearchItems(cards: MangaCard[]): SearchResultItem[] {
  return cards.map((card) => ({
    mangaId: card.mangaId,
    title: card.title,
    imageUrl: card.imageUrl,
    contentRating: card.contentRating,
  }));
}

// Featured hero stat pills: ★ rating and read count, when present.
function topMangaInfoItems(item: TopMangaItem): FeaturedCarouselItem["infoItems"] {
  const pills: { symbol: string; text: string }[] = [];
  if (item.rating) pills.push({ symbol: "star.fill", text: item.rating });
  if (item.reads) pills.push({ symbol: "flame.fill", text: item.reads });
  if (pills.length === 0) return undefined;
  return (
    pills.length === 1 ? [pills[0]] : [pills[0], pills[1]]
  ) as FeaturedCarouselItem["infoItems"];
}

export class OniSagaExtension implements ExtensionImpl<typeof OniSagaConfig> {
  requestManager = new OniSagaInterceptor("onisaga-request");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  // Browse/search/discover share this generous limiter; images load freely.
  globalRateLimiter = new BasicRateLimiter("onisaga-rate-limiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // The reader's page API gets its own paced budget: a quick initial burst,
  // then the Image Requests Limit spacing (see network.ts).
  pageRateLimiter = new OniSagaPageRateLimiter("onisaga-page-rate-limiter");

  // Cached `post-filter` states (token + snapshot) per listing URL — /browse
  // plus each active /search/{term}. A single shared slot would let every new
  // search evict the /browse state (and vice versa), re-downloading the 10MB+
  // /browse document on each swap. Snapshots refresh themselves on every
  // successful Livewire response, so the TTL only bounds how often the big
  // documents are re-fetched; in-flight fetches are de-duped so parallel rails
  // share one download.
  private browseStates = new Map<string, { state: LivewireState; at: number }>();
  private browseStateFetches = new Map<string, Promise<LivewireState | undefined>>();
  private static readonly BROWSE_STATE_TTL = 1_800_000;
  private static readonly BROWSE_STATE_CACHE_MAX = 8;

  // Cached server-rendered /trending document (the toggle rails live here).
  private homeHtmlCache?: { html: string; at: number };
  private static readonly HOME_TTL = 60_000;

  // Cached /home document. It server-renders the Latest, Fan Favorites and Top
  // Rated rails inline, so one fetch serves several rails instead of a separate
  // (10MB+) /browse or /top-manga request each.
  private homeDocCache?: { html: string; at: number };
  private homeDocFetch?: Promise<string>;

  // Cached /top-manga rankings by sort. The featured + highest-rated rails both
  // pull from this slow (~3s) ranking page, and the discover screen re-requests
  // rails as it refreshes/scrolls, so cache each sort briefly to collapse the
  // repeated fetches into one.
  private topMangaCache = new Map<string, { items: TopMangaItem[]; at: number }>();
  private static readonly TOP_MANGA_TTL = 60_000;

  async initialise(): Promise<void> {
    this.cookieStorageInterceptor.registerInterceptor();
    this.requestManager.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
    this.pageRateLimiter.registerInterceptor();
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
    return new OniSagaSettingsForm();
  }

  async getAdvancedSearchForm(
    query: SearchQuery<OniSagaSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new OniSagaAdvancedSearchForm(query);
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
    // Toggle rails render as chip rows; a chip tap routes through getSearchResults.
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
            } satisfies OniSagaSearchMetadata,
          },
          name: option.title,
        })),
      };
    }

    switch (section.id) {
      case "top_manga":
        return this.getTopMangaFeatured();
      case "latest":
        return this.fetchLatest(metadata);
      case "highest_rated": {
        const items = this.dropBlacklisted(await this.fetchTopManga("rated"));
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
      case "fan_favorites":
        return this.fetchFanFavorites();
      case "genres": {
        // Drop blacklisted genres: including one here while searchUpdates also
        // adds it to excludeGenre would send it as both included and excluded.
        const excluded = new Set(getExcludedGenres());
        return {
          items: getGenres()
            .filter((genre) => !excluded.has(genre.id))
            .map((genre) => ({
              type: "genresCarouselItem",
              searchQuery: {
                title: "",
                metadata: { genres: { [genre.id]: "included" } } satisfies OniSagaSearchMetadata,
              },
              name: genre.title,
            })),
        };
      }
      case "types":
        return {
          items: TYPE_OPTIONS.filter((t) => t.id).map((type) => ({
            type: "genresCarouselItem",
            searchQuery: {
              title: "",
              metadata: { type: type.id } satisfies OniSagaSearchMetadata,
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

  // Featured hero from the /top-manga ranking (one request, no per-item lookups).
  private async getTopMangaFeatured(): Promise<PagedResults<DiscoverSectionItem>> {
    const items = this.dropBlacklisted(await this.fetchTopManga("reads")).slice(0, FEATURED_LIMIT);

    return {
      items: items.map((item) => ({
        type: "featuredCarouselItem",
        mangaId: item.mangaId,
        imageUrl: item.imageUrl,
        title: item.title,
        supertitle: item.genres,
        infoItems: topMangaInfoItems(item),
        contentRating: item.contentRating,
      })),
    };
  }

  // The /top-manga ranking (by reads or rating); its rows carry the read count
  // and ★ rating that /browse cards lack.
  private async fetchTopManga(sort: "reads" | "rated"): Promise<TopMangaItem[]> {
    const showNsfw = getShowNsfw();
    const key = `${sort}:${showNsfw}`;
    const now = Date.now();
    const cached = this.topMangaCache.get(key);
    if (cached && now - cached.at < OniSagaExtension.TOP_MANGA_TTL) return cached.items;

    try {
      const $ = await this.fetchCheerio({ url: `${DOMAIN}/top-manga?sort=${sort}`, method: "GET" });
      const items = parseTopManga($, showNsfw);
      this.topMangaCache.set(key, { items, at: now });
      return items;
    } catch (error) {
      // A Cloudflare wall must reach the user as the bypass prompt.
      if (error instanceof CloudflareError) throw error;
      return [];
    }
  }

  // /trending carries the Livewire toggle rails; pull it once and cache it.
  private async fetchHomeHtml(): Promise<string> {
    const now = Date.now();
    const cached = this.homeHtmlCache;
    if (cached && now - cached.at < OniSagaExtension.HOME_TTL) return cached.html;

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/trending`,
      method: "GET",
    });
    const html = Application.arrayBufferToUTF8String(buffer);
    this.homeHtmlCache = { html, at: now };
    return html;
  }

  // POST a Livewire update and return the first component's re-render.
  private async livewireUpdate(
    referer: string,
    request: unknown,
    context: string,
  ): Promise<{ html?: string; snapshot?: string }> {
    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/livewire/update`,
      method: "POST",
      headers: livewireHeaders(referer),
      body: JSON.stringify(request),
    });
    const component = parseJson<LivewireResponse>(
      Application.arrayBufferToUTF8String(buffer),
      context,
    ).components?.[0];
    return {
      html: component?.effects?.html ?? undefined,
      snapshot: component?.snapshot ?? undefined,
    };
  }

  // One cached /home fetch, de-duped so the rails that read it (Latest, Fan
  // Favorites) share a single request instead of each downloading it.
  private async getHomeDoc(): Promise<string> {
    const now = Date.now();
    if (this.homeDocCache && now - this.homeDocCache.at < OniSagaExtension.HOME_TTL) {
      return this.homeDocCache.html;
    }
    if (this.homeDocFetch) return this.homeDocFetch;

    this.homeDocFetch = (async () => {
      const [, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/home`,
        method: "GET",
      });
      const html = Application.arrayBufferToUTF8String(buffer);
      this.homeDocCache = { html, at: Date.now() };
      return html;
    })();
    try {
      return await this.homeDocFetch;
    } finally {
      this.homeDocFetch = undefined;
    }
  }

  // The Latest rail: page 1 comes free from the cached /home doc's "Latest
  // Mangas" grid (no 10MB+ /browse download); deeper pages fall back to the
  // Livewire browse path.
  private async fetchLatest(
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const map = (card: MangaCard): DiscoverSectionItem => ({
      type: "simpleCarouselItem",
      mangaId: card.mangaId,
      imageUrl: card.imageUrl,
      title: card.title,
      subtitle: buildStatSubtitle(card),
      contentRating: card.contentRating,
    });

    // Only the very first load (page 1, nothing collected yet) takes the /home
    // shortcut; once it seeds collectedIds the follow-ups fall to browse.
    if ((metadata?.page ?? 1) === 1 && (metadata?.collectedIds?.length ?? 0) === 0) {
      try {
        const cards = parseHomeRail(await this.getHomeDoc(), "Latest Mangas", getShowNsfw());
        if (cards.length > 0) {
          // The /home grid is ~15 cards, short of a full browse page (24), so
          // hand the next scroll to browse page 1 (not page 2) and seed the home
          // ids to de-dupe the overlap — otherwise the tail of browse page 1
          // (items 16-24) would be skipped entirely.
          return {
            items: cards.map(map),
            metadata: { page: 1, collectedIds: cards.map((card) => card.mangaId) },
          };
        }
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        // Fall through to the Livewire browse path.
      }
    }
    return this.browseDiscover(DEFAULT_SORT, metadata, map);
  }

  // Fan Favorites is a Livewire component on /home. Parse its server-rendered
  // cards; if the page ships an un-hydrated placeholder, drive its render.
  private async fetchFanFavorites(): Promise<PagedResults<DiscoverSectionItem>> {
    const showNsfw = getShowNsfw();
    try {
      const homeUrl = `${DOMAIN}/home`;
      const $ = cheerio.load(await this.getHomeDoc());

      const component = componentHtmlByName($, "fan-favorites");
      let cards = component ? parseMangaCards(cheerio.load(component), showNsfw) : [];

      if (cards.length === 0) {
        const state = extractLivewireState($, "fan-favorites");
        if (state) {
          const { html } = await this.livewireUpdate(
            homeUrl,
            buildSectionToggleRequest(state, "setSort", "all-time"),
            "livewire fan-favorites",
          );
          cards = html ? parseMangaCards(cheerio.load(html), showNsfw) : [];
        }
      }

      return {
        items: this.dropBlacklisted(cards).map((card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        })),
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return { items: [] };
    }
  }

  // Client-side genre blacklist for home rails the site renders without a filter
  // (Fan Favorites). Its cards carry genre titles, not the ids browseDiscover
  // sends server-side, so match the excluded ids' titles against the card's.
  private dropBlacklisted<T extends { genres?: string }>(items: T[]): T[] {
    const excludedIds = new Set(getExcludedGenres());
    if (excludedIds.size === 0) return items;
    const excludedTitles = new Set(
      getGenres()
        .filter((genre) => excludedIds.has(genre.id))
        .map((genre) => genre.title.toLowerCase()),
    );
    if (excludedTitles.size === 0) return items;
    // Card/ranking genre lines use assorted separators ("Action / Adventure",
    // "Drama · Romance"), so split on any of them before matching.
    return items.filter((item) => {
      const titles = (item.genres ?? "").split(/[·/,]/).map((t) => t.trim().toLowerCase());
      return !titles.some((title) => excludedTitles.has(title));
    });
  }

  // A toggle chip was tapped: drive the rail's Livewire method on /trending and
  // parse the re-rendered cards.
  private async getToggledSection(
    sectionId: string,
    value: string,
  ): Promise<PagedResults<SearchResultItem>> {
    const toggle = SECTION_TOGGLES[sectionId];
    if (!toggle) return { items: [] };

    try {
      const $ = cheerio.load(await this.fetchHomeHtml());
      const state = extractLivewireState($, toggle.component);
      if (!state) return { items: [] };

      const { html } = await this.livewireUpdate(
        `${DOMAIN}/trending`,
        buildSectionToggleRequest(state, toggle.method, value),
        "livewire toggle",
      );
      if (!html) return { items: [] };
      const $component = cheerio.load(html);
      // The Top 10 component re-renders as a ranked list, not poster cards;
      // fall back to the anchor-based parser when the card markup is absent.
      let cards = parseMangaCards($component, getShowNsfw());
      if (cards.length === 0) cards = parseAnchorCards($component, getShowNsfw());

      return { items: toSearchItems(cards) };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return { items: [] };
    }
  }

  // ================================ Search =====================================

  async getSearchResults(
    query: SearchQuery<OniSagaSearchMetadata>,
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
      items: toSearchItems(cards),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private searchUpdates(meta: OniSagaSearchMetadata, sortId?: string): PostFilterUpdates {
    const updates = defaultUpdates();
    updates.sort = sortId || meta.sort || DEFAULT_SORT;
    // Advanced-search picks win; otherwise apply the saved discover filters,
    // which the settings form promises also apply to search.
    updates.platform = meta.type ?? getDiscoverType();
    updates.status = meta.status ?? getDiscoverStatus();
    updates.min_chapters = meta.minChapters ?? "";
    updates.group = meta.group?.trim() || null;
    updates.release_start = normalizeReleaseDate(meta.releaseStart, false);
    updates.release_end = normalizeReleaseDate(meta.releaseEnd, true);

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
    // Only resolve links that actually point at this source's site; a pasted
    // foreign URL must not be fetched with this source's headers.
    const host = rawUrl.match(/^https?:\/\/([^/]+)/i)?.[1]?.toLowerCase();
    if (!host || (host !== "onisaga.com" && !host.endsWith(".onisaga.com"))) return undefined;

    // Reader URLs embed the manga slug directly (/read/<slug>/<chapter>).
    const mangaId = mangaIdFromHref(rawUrl) || (rawUrl.match(/\/read\/([^/]+)/)?.[1] ?? "");
    if (!mangaId) return undefined;

    const $ = await this.fetchCheerio({ url: `${DOMAIN}/manga/${mangaId}`, method: "GET" });
    const details = parseMangaDetails($, mangaId);

    // Direct results honour the NSFW setting like every other list.
    if (!getShowNsfw() && details.mangaInfo.contentRating === ContentRating.ADULT) {
      return undefined;
    }

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
        const { html } = await this.livewireUpdate(
          mangaUrl,
          buildLoadMoreChaptersRequest(state),
          "livewire chapters",
        );
        if (html) {
          const full = parseChapters(cheerio.load(html), sourceManga);
          if (full.length > chapters.length) chapters = full;
        }
      } catch (error) {
        // Surface a Cloudflare challenge so the app opens the bypass flow;
        // keep the first server-rendered page for any other failure.
        if (error instanceof CloudflareError) throw error;
      }
    }

    // Keep only the user's chosen languages (default English); fall back to all
    // when a title has none in those languages so the list is never empty.
    const languages = getLanguages();
    const inLanguage = chapters.filter((chapter) => languages.includes(chapter.langCode));
    if (inLanguage.length > 0) chapters = inLanguage;

    // onisaga often carries several uploads of one chapter in the same language;
    // collapse them to the newest so the list isn't cluttered with duplicates.
    if (getDedupeChapters()) chapters = this.dedupeChapters(chapters);

    // Newest first: the highest chapter number gets the highest sortingIndex.
    chapters.sort((a, b) => b.chapNum - a.chapNum);
    chapters.forEach((chapter, index) => {
      chapter.sortingIndex = chapters.length - index;
    });
    return chapters;
  }

  // Collapse repeat uploads of the same chapter+language to a single entry,
  // keeping the newest by upload date (MangaDex's "Skip Same Chapter" / Aidoku's
  // dedupe). A numbered chapter keys on number+language; an unparseable one keys
  // on its title so genuinely distinct extras aren't merged into one.
  private dedupeChapters(chapters: Chapter[]): Chapter[] {
    const byNewest = [...chapters].sort(
      (a, b) => (b.publishDate?.getTime() ?? 0) - (a.publishDate?.getTime() ?? 0),
    );
    const seen = new Set<string>();
    const kept: Chapter[] = [];
    for (const chapter of byNewest) {
      const key =
        chapter.chapNum > 0
          ? `${chapter.chapNum}-${chapter.langCode}`
          : `${chapter.title}-${chapter.langCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(chapter);
    }
    return kept;
  }

  // Open in one request: return a page-API url per page without resolving any.
  // The interceptor fetches each page's signed image lazily as it's shown, so a
  // long chapter opens instantly instead of resolving every page up front.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = `${DOMAIN}${chapter.chapterId}`;
    const segments = chapter.chapterId.split("/").filter(Boolean);
    const cid = segments[segments.length - 1] ?? "";

    const [, buffer] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
    const body = Application.arrayBufferToUTF8String(buffer);

    const token = extractReaderToken(body);
    if (!token) throw new Error("Could not find reader token on chapter page");

    // Request pages by their embedded `order` values — the site's own reader
    // does the same, and orders can have gaps after re-imports, where a
    // sequential 0..N-1 range would miss pages. Fall back to the count.
    let orders = extractPageOrders(body);
    if (orders.length === 0) {
      const pageCount = countPages(body);
      if (pageCount === 0) throw new Error("No pages found in chapter");
      orders = Array.from({ length: pageCount }, (_, order) => order);
    }

    this.requestManager.setReaderToken(cid, token, chapterUrl);

    // A chapter still being imported embeds only a partial page list; the site's
    // reader grows it by polling /pages. Paperback gets a static list, so ask
    // that endpoint once for the authoritative set before answering.
    if (body.includes("importInProgress: true")) {
      const backfilled = await this.fetchImportingPageOrders(cid, token, chapterUrl);
      if (backfilled.length > orders.length) orders = backfilled;
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: orders.map((order) => `${DOMAIN}/api/chapter/${cid}/page/${order}`),
    };
  }

  // The token-gated page-listing endpoint the site's reader polls while a
  // chapter imports: GET /api/chapter/{cid}/pages?from=0 returns the current
  // authoritative { pages: [{order}], total_pages }. One call, only for
  // mid-import chapters; any failure just keeps the embedded (partial) list.
  private async fetchImportingPageOrders(
    cid: string,
    token: string,
    referer: string,
  ): Promise<number[]> {
    try {
      const [response, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/api/chapter/${cid}/pages?from=0`,
        method: "GET",
        headers: { "x-reader-token": token, referer },
      });
      // Adopt a rotated token so the reader session stays current.
      for (const [key, value] of Object.entries(response.headers ?? {})) {
        if (key.toLowerCase() === "x-reader-token-next" && value) {
          this.requestManager.setReaderToken(cid, value, referer);
        }
      }
      const dto = parseJson<{ pages?: { order?: number }[] }>(
        Application.arrayBufferToUTF8String(buffer),
        "chapter pages listing",
      );
      const orders = new Set<number>();
      for (const page of dto?.pages ?? []) {
        if (typeof page.order === "number") orders.add(page.order);
      }
      return [...orders].sort((a, b) => a - b);
    } catch (error) {
      // A Cloudflare wall on the backfill must surface as the bypass prompt, not
      // be swallowed into a silently truncated page list.
      if (error instanceof CloudflareError) throw error;
      return [];
    }
  }

  // ============================== Livewire browse ==============================

  // All browse/search listing goes through the Livewire component, page 1
  // included: its responses carry only one page of cards, while the /browse
  // document itself can exceed 10 MB — far too big to parse on-device.
  private async fetchBrowse(
    baseUrl: string,
    updates: PostFilterUpdates,
    page: number,
  ): Promise<{ cards: MangaCard[]; hasNext: boolean }> {
    const showNsfw = getShowNsfw();

    const state = await this.resolveBrowseState(baseUrl);
    if (!state) return { cards: [], hasNext: false };

    const { html, snapshot } = await this.livewireUpdate(
      baseUrl,
      buildBrowseRequest(state, updates, page),
      "livewire browse",
    );
    if (!html) {
      this.browseStates.delete(baseUrl);
      return { cards: [], hasNext: false };
    }

    if (snapshot) {
      this.storeBrowseState(baseUrl, { token: state.token, snapshot });
    }

    // Never cheerio-load the whole response: a filtered browse render can be
    // 15 MB, which freezes the device. Slice cards off the raw string instead.
    const cards = parseMangaCardsFromHtml(html, showNsfw);
    // The browse component paginates server-side (~24 cards/page), and its
    // "next" control markup varies, so the button regex alone would often miss
    // it — leaving search stuck on the first page. Treat a full page as "there's
    // more" (an empty next page terminates the loop); only skip the heuristic
    // when we truncated a whole-catalog render (cards == cap), where paging the
    // client-side list would just repeat the same items.
    const fullPage = cards.length >= BROWSE_PAGE_SIZE && cards.length < CARD_PARSE_CAP;
    return {
      cards,
      hasNext: fullPage || hasNextPageFromHtml(html),
    };
  }

  private storeBrowseState(baseUrl: string, state: LivewireState): void {
    this.browseStates.delete(baseUrl);
    this.browseStates.set(baseUrl, { state, at: Date.now() });
    // Bound the cache: drop the stalest entry (search terms come and go).
    if (this.browseStates.size > OniSagaExtension.BROWSE_STATE_CACHE_MAX) {
      let oldestKey = "";
      let oldestAt = Infinity;
      for (const [key, entry] of this.browseStates) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at;
          oldestKey = key;
        }
      }
      this.browseStates.delete(oldestKey);
    }
  }

  private async resolveBrowseState(baseUrl: string): Promise<LivewireState | undefined> {
    const cached = this.browseStates.get(baseUrl);
    if (cached && Date.now() - cached.at < OniSagaExtension.BROWSE_STATE_TTL) {
      return cached.state;
    }

    // De-dupe concurrent misses: parallel discover rails and a search can all
    // want the same state at once, and each miss costs a full document
    // download (the /browse page alone can exceed 10 MB).
    const inFlight = this.browseStateFetches.get(baseUrl);
    if (inFlight) return inFlight;

    const task = (async () => {
      // Regex extraction on the raw text — never cheerio-parse the huge document.
      const [, data] = await Application.scheduleRequest({ url: baseUrl, method: "GET" });
      const html = Application.arrayBufferToUTF8String(data);
      const state = extractLivewireStateFromHtml(html, "post-filter");
      if (state) this.storeBrowseState(baseUrl, state);
      return state;
    })();

    this.browseStateFetches.set(baseUrl, task);
    try {
      return await task;
    } finally {
      this.browseStateFetches.delete(baseUrl);
    }
  }

  async fetchCheerio(request: Request): Promise<cheerio.CheerioAPI> {
    const [, data] = await Application.scheduleRequest(request);
    return cheerio.load(Application.arrayBufferToUTF8String(data));
  }
}

export const OniSaga = new OniSagaExtension();
