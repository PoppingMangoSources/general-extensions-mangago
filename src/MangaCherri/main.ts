/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { getBaseUrl, MangaCherriAdvancedSearchForm, MangaCherriSettingsForm } from "./forms";
import { GENRES, HOME_TITLES, SECTIONS, type PageMetadata, type SearchMetadata } from "./models";
import { fetchHtml, MangaCherriInterceptor } from "./network";
import {
  contentRatingForGenres,
  parseCarouselSection,
  parseChapterList,
  parseLatestSection,
  parseListingCards,
  parseMangaDetails,
  parseReaderPages,
  toFeaturedItems,
  toLatestItems,
  toRatedChapterItems,
  toSearchResultItems,
  toWeeklyItems,
} from "./parsers";
import type MangaCherriConfig from "./pbconfig";

export class MangaCherriExtension implements ExtensionImpl<typeof MangaCherriConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private interceptor = new MangaCherriInterceptor("main");

  // The home page feeds four sections; share one in-flight fetch so a refresh
  // burst is a single request while still refetching on the next refresh.
  private homePromise?: Promise<cheerio.CheerioAPI>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaCherriSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.featured },
      { id: SECTIONS.WEEKLY, title: "Weekly", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.LATEST, title: "Latest Chapter", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.POPULAR_NOW, title: "Popular Now", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.COMPLETED,
        title: "Completed Romance",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.POPULAR:
        return {
          items: toFeaturedItems(parseCarouselSection(await this.getHome(), HOME_TITLES.POPULAR)),
        };
      case SECTIONS.WEEKLY:
        return this.getWeeklySection();
      case SECTIONS.LATEST:
        return { items: toLatestItems(parseLatestSection(await this.getHome())) };
      case SECTIONS.POPULAR_NOW:
        return {
          items: toRatedChapterItems(
            parseCarouselSection(await this.getHome(), HOME_TITLES.POPULAR_NOW),
          ),
        };
      case SECTIONS.COMPLETED:
        return {
          items: toRatedChapterItems(
            parseCarouselSection(await this.getHome(), HOME_TITLES.COMPLETED),
          ),
        };
      case SECTIONS.GENRES:
        return { items: this.genreChipItems() };
      default:
        return { items: [] };
    }
  }

  private async getWeeklySection(): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchHtml(`${getBaseUrl()}/weekly-manga.php`);
    return { items: toWeeklyItems(parseListingCards(html)) };
  }

  private genreChipItems(): DiscoverSectionItem[] {
    return GENRES.map((genre) => ({
      type: "genresCarouselItem",
      name: genre.value,
      searchQuery: {
        title: "",
        metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
      },
      contentRating: contentRatingForGenres([genre.value]),
    }));
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MangaCherriAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const term = (query.title ?? "").trim();
    const genreId = Object.keys(query.metadata?.genres ?? {})[0];
    const url = term
      ? `${getBaseUrl()}/search.php?keyword=${encodeURIComponent(term)}`
      : genreId
        ? `${getBaseUrl()}/genre.php?genre=${encodeURIComponent(this.genreName(genreId))}`
        : `${getBaseUrl()}/home.php`;

    const page = metadata?.page ?? 1;
    const seen = new Set(metadata?.seen ?? []);
    const cards = parseListingCards(await fetchHtml(page > 1 ? `${url}&page=${page}` : url));

    // The pagination markup isn't uniform across these pages, so stop once a
    // page adds nothing new rather than trusting a page param blindly.
    const fresh = cards.filter((card) => !seen.has(card.slug));
    for (const card of fresh) seen.add(card.slug);

    return {
      items: toSearchResultItems(fresh),
      metadata: fresh.length > 0 ? { page: page + 1, seen: [...seen] } : undefined,
    };
  }

  private genreName(id: string): string {
    return GENRES.find((genre) => genre.id === id)?.value ?? id;
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const host = getBaseUrl()
      .replace(/^https?:\/\//, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const slug = new RegExp(`^https?://(?:www\\.)?${host}/([^/?#]+)/?$`, "i").exec(
      query.trim(),
    )?.[1];
    if (!slug || slug.endsWith(".php")) return undefined;

    const manga = await this.getMangaDetails(decodeURIComponent(slug));
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
    return parseMangaDetails(await fetchHtml(`${getBaseUrl()}/${mangaId}`), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapterList(await fetchHtml(`${getBaseUrl()}/${sourceManga.mangaId}`), sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await fetchHtml(
      `${getBaseUrl()}/${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
    );
    return parseReaderPages(html, chapter);
  }

  private getHome(): Promise<cheerio.CheerioAPI> {
    this.homePromise ??= fetchHtml(`${getBaseUrl()}/home.php`)
      .then((html) => cheerio.load(html))
      .finally(() => {
        this.homePromise = undefined;
      });
    return this.homePromise;
  }
}

export const MangaCherri = new MangaCherriExtension();
