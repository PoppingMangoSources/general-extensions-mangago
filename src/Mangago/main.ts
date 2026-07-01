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
  type FeaturedCarouselItem,
  type Form,
  type PagedResults,
  type Request,
  type Response,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { MangagoAdvancedSearchForm } from "./forms/search";
import { MangagoSettingsForm, getDiscoverSectionEnabled } from "./forms/settings";
import {
  DISCOVER_SECTION_ALIASES,
  DISCOVER_SECTION_OPTIONS,
  DOMAIN,
  FEATURED_HERO_LIMIT,
  GENRE_OPTIONS,
  getGenreTitle,
  SORT_OPTIONS,
  type MangagoSearchMetadata,
} from "./models";
import { MangagoInterceptor, applyMangagoHeaders, fetchPage, getFeaturedInfo } from "./network";
import {
  buildDiscoverUrl,
  buildGenreFilterUrl,
  contentRatingForGenres,
  filterNewChapters,
  hasNextPage,
  parseChapters,
  parseLatestUpdates,
  parseListings,
  parseMangaDetails,
  sortingIdToMangagoSort,
} from "./parsers";
import type MangagoConfig from "./pbconfig";
import { getMangagoPageUrls } from "./utils/reader";
import { absoluteUrl, canonicalReaderUrl } from "./utils/urls";

class MangagoExtension implements ExtensionImpl<typeof MangagoConfig> {
  private interceptor = new MangagoInterceptor("mangago-interceptor");

  // 3 req/s for HTML/API traffic; images aren't counted and the reader walk paces
  // itself.
  private rateLimiter = new BasicRateLimiter("mangago-rate-limiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  async initialise(): Promise<void> {
    // Register the Mangago interceptor last so it can read the bypass cookies the
    // CookieStorageInterceptor injected and merge our headers/cookie/UA on top.
    this.cookieStorageInterceptor.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();

    // interceptRequest only runs on the initial request, so re-apply our headers to
    // redirect targets (numeric /chapter/ -> /read-manga/ must stay desktop).
    Application.setRedirectHandler(
      Application.Selector(this as MangagoExtension, "handleRedirect"),
    );
  }

  async handleRedirect(request: Request, _response: Response): Promise<Request> {
    return await applyMangagoHeaders(request);
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map(({ id, label }) => ({ id, label }));
  }

  async getSettingsForm(): Promise<Form> {
    return new MangagoSettingsForm();
  }

  async getAdvancedSearchForm(
    query: SearchQuery<MangagoSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new MangagoAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<MangagoSearchMetadata>,
    metadata?: MangagoSearchMetadata,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = query.title?.trim() ?? "";

    // mangago can't combine free text with the genre filter, so the form's
    // genre/status only apply to the no-title browse path. An explicit sort pick
    // wins (incl. "Alphabetical" -> ""); else the query default (tiles use "view").
    const sortby = sortingOption
      ? sortingIdToMangagoSort(sortingOption)
      : (query.metadata?.sortby ?? "");
    const url = title
      ? `${DOMAIN}/r/l_search?name=${encodeURIComponent(title)}&page=${page}`
      : buildGenreFilterUrl(query.metadata, page, sortby);

    const { html } = await fetchPage(url);
    const items = parseListings(html);

    return {
      items,
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTION_OPTIONS.filter((section) => getDiscoverSectionEnabled(section.id)).map(
      (section) => ({
        id: section.id,
        title: section.title,
        type: section.type,
      }),
    );
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: MangagoSearchMetadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const sectionId = DISCOVER_SECTION_ALIASES[section.id] ?? section.id;

    // Genre grid: static tiles, each tapping into a genre-filtered search.
    if (sectionId === "genres") {
      const items: DiscoverSectionItem[] = GENRE_OPTIONS.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          // `genres` (by id) drives getSearchResults; `genre` (title) pre-selects
          // the genre in the advanced-search form.
          metadata: { genre: genre.title, genres: { [genre.id]: "included" }, sortby: "view" },
        },
        contentRating: contentRatingForGenres([genre.title]),
      }));

      return { items, metadata: undefined };
    }

    const option = DISCOVER_SECTION_OPTIONS.find((s) => s.id === sectionId);
    const page = metadata?.page ?? 1;
    const url = buildDiscoverUrl(sectionId, page);

    const { html } = await fetchPage(url);

    const searchItems = (
      sectionId === "new_chapters"
        ? filterNewChapters(parseLatestUpdates(html))
        : parseListings(html)
    ).slice(0, option?.limit); // no limit -> whole page

    const sectionType = option?.type ?? DiscoverSectionType.simpleCarousel;
    // Genre-locked tops carry a known rating; mixed sections span all genres.
    const sectionRating = sectionId.startsWith("top_")
      ? contentRatingForGenres([getGenreTitle(sectionId.replace(/^top_/, ""))])
      : undefined;

    // Featured hero: rating + status pills from each title's (cached) detail page.
    if (sectionId === "featured_manga") {
      const heroItems = await Promise.all(
        searchItems
          .slice(0, FEATURED_HERO_LIMIT)
          .map(async (item): Promise<DiscoverSectionItem> => {
            const info = await getFeaturedInfo(item.mangaId);
            const pills: { symbol: string; text: string }[] = [];
            if (info.rating) pills.push({ symbol: "star.fill", text: info.rating });
            if (info.status) pills.push({ symbol: "book.fill", text: info.status });

            return {
              type: "featuredCarouselItem",
              mangaId: item.mangaId,
              title: item.title,
              imageUrl: item.imageUrl,
              supertitle: info.author ?? item.subtitle,
              summary: info.summary,
              infoItems: pills.length
                ? (pills.slice(0, 2) as FeaturedCarouselItem["infoItems"])
                : undefined,
              metadata: undefined,
            };
          }),
      );

      return { items: heroItems, metadata: undefined };
    }

    const carouselType =
      sectionType === DiscoverSectionType.featured
        ? "featuredCarouselItem"
        : sectionType === DiscoverSectionType.prominentCarousel
          ? "prominentCarouselItem"
          : "simpleCarouselItem";

    const items: DiscoverSectionItem[] = searchItems.flatMap((item): DiscoverSectionItem[] => {
      const base = { mangaId: item.mangaId, title: item.title, imageUrl: item.imageUrl };

      if (sectionType === DiscoverSectionType.chapterUpdates) {
        if (!item.chapterId) return []; // the carousel item requires a chapterId
        return [
          {
            type: "chapterUpdatesCarouselItem",
            ...base,
            chapterId: item.chapterId,
            subtitle: item.subtitle,
            publishDate: item.publishDate,
            contentRating: item.genres?.length
              ? contentRatingForGenres(item.genres)
              : sectionRating,
            metadata: undefined,
          },
        ];
      }

      // Featured shows the caption above the title (supertitle); carousels below it.
      const caption =
        sectionType === DiscoverSectionType.featured
          ? { supertitle: item.subtitle }
          : { subtitle: item.subtitle };
      return [
        {
          type: carouselType,
          ...base,
          ...caption,
          contentRating: sectionRating,
          metadata: undefined,
        },
      ];
    });

    // Uncapped sections paginate: hand back the next page cursor whenever the
    // fetched page advertises a next page. Capped "Top N" sections and the
    // single-page zone homepage carousels (no pager) stop after one page.
    return {
      items,
      metadata:
        option?.limit === undefined && hasNextPage(html)
          ? { ...metadata, page: page + 1 }
          : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { html } = await fetchPage(absoluteUrl(mangaId));

    return parseMangaDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { html } = await fetchPage(absoluteUrl(sourceManga.mangaId));

    return parseChapters(html, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    // The id is self-sufficient (an absolute mirror URL or a read-manga path);
    // getMangagoPageUrls sweeps every mirror for numeric-only titles.
    const pages = await getMangagoPageUrls(canonicalReaderUrl(absoluteUrl(chapter.chapterId)));

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      this.cookieStorageInterceptor.deleteCookie(cookie);
    }

    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }

      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }
}

export const Mangago = new MangagoExtension();
