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
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import type * as cheerio from "cheerio";

import { MangaHomeAdvancedSearchForm } from "./forms";
import {
  AWESOME_TAB_INDEX,
  DOMAIN,
  GENRES,
  HOME_TITLES,
  RANK_TITLES,
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
  fetchDocument,
  homeUrl,
  listingUrl,
  MangaHomeInterceptor,
  mangaUrl,
  rankUrl,
  searchUrl,
} from "./network";
import {
  contentRatingForGenres,
  parseChapterImages,
  parseChapters,
  parseFeelingSection,
  parseHasNextPage,
  parseMangaDetails,
  parseMangaList,
  parseRankSection,
  parseRecommendList,
  toChapterUpdateItem,
  toFeaturedItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type MangaHomeConfig from "./pbconfig";

export class MangaHomeExtension implements ExtensionImpl<typeof MangaHomeConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 4,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new MangaHomeInterceptor("main");

  // Four carousels come from the home page and three from the ranking page; share
  // each in-flight fetch so a refresh burst stays at one request per document.
  private homePromise?: Promise<cheerio.CheerioAPI>;
  private rankPromise?: Promise<cheerio.CheerioAPI>;
  private rankCoverPromises = new Map<string, Promise<string>>();

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
    this.homePromise = undefined;
    this.rankPromise = undefined;
    this.rankCoverPromises.clear();
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    Application.invalidateDiscoverSections();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.FEATURED, title: "Featured Manga", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.HOT_YAOI,
        title: "Hot Yaoi Manga Releases",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.NEW_SHOUJO,
        title: "New Shoujo Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.COMPLETED_SHOUJO,
        title: "Completed Shoujo Manga",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.LATEST, title: "Latest Releases", type: DiscoverSectionType.chapterUpdates },
      {
        id: SECTIONS.TOP_SHOUJO_WEEK,
        title: "Top Shoujo This Week",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.TOP_VIEWED_SHOUJO,
        title: "Top Viewed Shoujo",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.TOP_RATED_SHOUJO,
        title: "Top Rated Shoujo",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.MOST_VIEWED_YAOI,
        title: "Most Viewed Yaoi",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.TOP_YAOI_WEEK,
        title: "Top Yaoi This Week",
        type: DiscoverSectionType.featured,
      },
      {
        id: SECTIONS.AWESOME,
        title: "Awesome Ranking",
        type: DiscoverSectionType.featured,
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
      case SECTIONS.FEATURED:
        return { items: (await this.getRecommended(HOME_TITLES.FEATURED)).map(toFeaturedItem) };
      case SECTIONS.HOT_YAOI:
        return { items: (await this.getRecommended(HOME_TITLES.HOT_YAOI)).map(toSimpleItem) };
      case SECTIONS.NEW_SHOUJO:
        return { items: (await this.getRecommended(HOME_TITLES.NEW_SHOUJO)).map(toSimpleItem) };
      case SECTIONS.COMPLETED_SHOUJO:
        return {
          items: (await this.getRecommended(HOME_TITLES.COMPLETED_SHOUJO)).map(toSimpleItem),
        };
      case SECTIONS.LATEST:
        return this.getLatestSection(metadata);
      case SECTIONS.TOP_SHOUJO_WEEK:
        return { items: (await this.getRanked(RANK_TITLES.SHOUJO)).map(toFeaturedItem) };
      case SECTIONS.TOP_VIEWED_SHOUJO:
        return this.getDirectorySection("shoujo", "views", metadata);
      case SECTIONS.TOP_RATED_SHOUJO:
        return this.getDirectorySection("shoujo", "rating", metadata);
      case SECTIONS.MOST_VIEWED_YAOI:
        return this.getDirectorySection("yaoi", "views", metadata);
      case SECTIONS.TOP_YAOI_WEEK:
        return { items: (await this.getRanked(RANK_TITLES.YAOI)).map(toFeaturedItem) };
      case SECTIONS.AWESOME:
        return {
          items: (await this.getFeelingRanked(AWESOME_TAB_INDEX)).map(toFeaturedItem),
        };
      case SECTIONS.GENRES:
        return this.getGenreSection();
      default:
        return { items: [] };
    }
  }

  private async getLatestSection(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchDocument(listingUrl("latest", page));
    return {
      items: parseMangaList($).flatMap((item) => {
        const card = toChapterUpdateItem(item);
        return card ? [card] : [];
      }),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private async getDirectorySection(
    path: string,
    sort: string,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const $ = await fetchDocument(listingUrl(path, page, SORT_TOKENS[sort]));
    return {
      items: parseMangaList($).map(toFeaturedItem),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private getGenreSection(): PagedResults<DiscoverSectionItem> {
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

  private async getRecommended(heading: string): Promise<MangaListItem[]> {
    return parseRecommendList(await this.getHome(), heading);
  }

  private async getRanked(heading: string): Promise<MangaListItem[]> {
    return this.hydrateRankImages(parseRankSection(await this.getRank(), heading));
  }

  private async getFeelingRanked(index: number): Promise<MangaListItem[]> {
    return this.hydrateRankImages(parseFeelingSection(await this.getRank(), index));
  }

  // The rank page omits covers after third place, so complete only those rows
  // from their detail pages and memoize the result for the session.
  private async hydrateRankImages(items: MangaListItem[]): Promise<MangaListItem[]> {
    const hydrated = [...items];
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < hydrated.length) {
        const index = cursor++;
        const item = hydrated[index];
        if (item.imageUrl.length > 0) continue;
        const imageUrl = await this.getRankCover(item.mangaId);
        if (imageUrl) hydrated[index] = { ...item, imageUrl };
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, hydrated.length) }, worker));
    return hydrated.filter((item) => item.imageUrl.length > 0);
  }

  private getRankCover(mangaId: string): Promise<string> {
    const cached = this.rankCoverPromises.get(mangaId);
    if (cached) return cached;

    const request = fetchDocument(mangaUrl(mangaId))
      .then(($) => parseMangaDetails($, mangaId).mangaInfo.thumbnailUrl)
      .catch((error: unknown) => {
        this.rankCoverPromises.delete(mangaId);
        if (error instanceof CloudflareError) throw error;
        return "";
      });
    this.rankCoverPromises.set(mangaId, request);
    return request;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MangaHomeAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const request = this.buildSearchRequest(query);
    const isFiltered = Object.values(request).some((value) =>
      Array.isArray(value) ? value.length > 0 : Boolean(value),
    );

    // The advanced-search endpoint has no ordering of its own, so an unfiltered
    // browse goes through the directory instead, where the sort tabs apply.
    const $ = await fetchDocument(
      isFiltered
        ? searchUrl(page, request)
        : listingUrl("shoujo", page, SORT_TOKENS[sortingOption?.id ?? "views"]),
    );

    return {
      items: parseMangaList($).map(toSearchResultItem),
      metadata: parseHasNextPage($) ? { page: page + 1 } : undefined,
    };
  }

  private buildSearchRequest(query: SearchQuery<SearchMetadata>): SearchRequest {
    const metadata = query.metadata ?? {};
    const genres = Object.entries(metadata.genres ?? {});
    return {
      name: (query.title ?? "").trim() || undefined,
      nameMethod: metadata.nameMatch?.[0],
      author: metadata.author,
      authorMethod: metadata.authorMatch?.[0],
      artist: metadata.artist,
      artistMethod: metadata.artistMatch?.[0],
      type: metadata.type?.[0],
      includedGenres: genres.filter(([, state]) => state === "included").map(([id]) => id),
      excludedGenres: genres.filter(([, state]) => state === "excluded").map(([id]) => id),
      released: metadata.released,
      releasedMethod: metadata.releasedMatch?.[0],
      rating: metadata.rating?.[0],
      ratingMethod: metadata.ratingMatch?.[0],
      isCompleted: metadata.completed?.[0],
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const mangaId = /^https?:\/\/(?:www\.)?mangahome\.com\/manga\/([^/?#]+)/i.exec(
      query.trim(),
    )?.[1];
    if (!mangaId) return undefined;

    const manga = await this.getMangaDetails(mangaId);
    return {
      items: [
        {
          mangaId: manga.mangaId,
          title: manga.mangaInfo.primaryTitle,
          imageUrl: manga.mangaInfo.thumbnailUrl,
          contentRating: manga.mangaInfo.contentRating,
        },
      ],
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchDocument(mangaUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await fetchDocument(mangaUrl(sourceManga.mangaId)), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const readerUrl = chapterUrl(chapter.sourceManga.mangaId, chapter.chapterId);
    const $ = await fetchDocument(readerUrl);
    const pages = await this.completeLegacyChapterImages($, readerUrl, parseChapterImages($));
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  // Older chapters expose one image at a time through chapterfun.ashx.
  private async completeLegacyChapterImages(
    $: cheerio.CheerioAPI,
    readerUrl: string,
    existingPages: string[],
  ): Promise<string[]> {
    const scripts = $("script:not([src])")
      .toArray()
      .map((element) => $(element).text())
      .join("\n");
    const chapterId = /(?:var\s+)?chapter_?id\s*=\s*(\d+)/i.exec(scripts)?.[1];
    const imageCount = Number.parseInt(
      /(?:var\s+)?imagecount\s*=\s*(\d+)/i.exec(scripts)?.[1] ?? "",
      10,
    );
    if (!chapterId || !Number.isFinite(imageCount) || imageCount < 1) return existingPages;
    if (existingPages.length >= imageCount) return existingPages;

    const userAgent = await Application.getDefaultUserAgent();
    const raw = await Application.executeInWebView({
      source: {
        html: $.html(),
        baseUrl: readerUrl,
        loadCSS: false,
        loadImages: false,
        userAgent,
      },
      inject: `
        return (async function () {
          var chapterId = ${JSON.stringify(chapterId)};
          var imageCount = ${imageCount};
          var seed = ${JSON.stringify(existingPages)};
          var pages = new Array(imageCount);

          function normalize(value) {
            if (typeof value !== "string" || value.length === 0) return "";
            var link = document.createElement("a");
            link.href = value;
            return link.href;
          }

          function firstString(value) {
            if (typeof value === "string") return value;
            if (!Array.isArray(value)) return "";
            for (var index = 0; index < value.length; index++) {
              if (typeof value[index] === "string" && value[index].length > 0) {
                return value[index];
              }
            }
            return "";
          }

          for (var seedIndex = 0; seedIndex < seed.length && seedIndex < imageCount; seedIndex++) {
            pages[seedIndex] = normalize(seed[seedIndex]);
          }

          var firstImage = document.querySelector("#image");
          if (!pages[0] && firstImage) {
            pages[0] = normalize(firstImage.getAttribute("src") || firstImage.src);
          }

          var keyInput = document.querySelector('input[id$="_key"], input[name="key"]');
          var key = keyInput && "value" in keyInput ? String(keyInput.value || "") : "";

          async function loadPage(page) {
            if (pages[page - 1]) return pages[page - 1];

            try {
              var response = await fetch(
                "chapterfun.ashx?cid=" + encodeURIComponent(chapterId) +
                  "&page=" + page +
                  "&key=" + encodeURIComponent(page === 1 ? key : ""),
                {
                  credentials: "include",
                  headers: { Accept: "*/*", "X-Requested-With": "XMLHttpRequest" },
                },
              );
              if (!response.ok) return "";

              var source = await response.text();
              window.d = undefined;
              window.newImgs = undefined;
              window.pix = undefined;
              window.pvalue = undefined;

              var result;
              try {
                result = window.eval(source);
              } catch (error) {}

              var pageUrl = firstString(result) || firstString(window.d) || firstString(window.newImgs);
              if (!pageUrl && typeof window.pix === "string") {
                var pageValue = firstString(window.pvalue);
                if (pageValue) pageUrl = window.pix + pageValue;
              }
              return normalize(pageUrl);
            } catch (error) {
              return "";
            }
          }

          for (var start = 1; start <= imageCount; start += 4) {
            var batch = [];
            for (var page = start; page < Math.min(start + 4, imageCount + 1); page++) {
              batch.push(loadPage(page));
            }
            var resolved = await Promise.all(batch);
            for (var offset = 0; offset < resolved.length; offset++) {
              if (resolved[offset]) pages[start + offset - 1] = resolved[offset];
            }
          }

          return JSON.stringify(pages.filter(Boolean));
        })();
      `,
      storage: { cookies: this.cookieStorageInterceptor.cookiesForUrl(`${DOMAIN}/`) },
    });

    if (typeof raw.result !== "string") return existingPages;
    try {
      const pages = JSON.parse(raw.result) as unknown;
      if (!Array.isArray(pages)) return existingPages;
      return pages.filter(
        (page): page is string => typeof page === "string" && /^https?:\/\//i.test(page),
      );
    } catch {
      return existingPages;
    }
  }

  private getHome(): Promise<cheerio.CheerioAPI> {
    this.homePromise ??= fetchDocument(homeUrl()).finally(() => {
      this.homePromise = undefined;
    });
    return this.homePromise;
  }

  private getRank(): Promise<cheerio.CheerioAPI> {
    this.rankPromise ??= fetchDocument(rankUrl()).finally(() => {
      this.rankPromise = undefined;
    });
    return this.rankPromise;
  }
}

export const MangaHome = new MangaHomeExtension();
