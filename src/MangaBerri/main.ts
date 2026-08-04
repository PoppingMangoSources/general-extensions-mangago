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

import { getBaseUrl, MangaBerriAdvancedSearchForm, MangaBerriSettingsForm } from "./forms";
import {
  GENRES,
  HOME_TITLES,
  RANKED_GENRES,
  SECTIONS,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchHtml, MangaBerriInterceptor } from "./network";
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
  toRankedItems,
  toRatedChapterItems,
  toSearchResultItems,
} from "./parsers";
import type MangaBerriConfig from "./pbconfig";

export class MangaBerriExtension implements ExtensionImpl<typeof MangaBerriConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private interceptor = new MangaBerriInterceptor("main");

  // The home page feeds three sections; share one in-flight fetch so a refresh
  // burst is a single request while still refetching on the next refresh.
  private homePromise?: Promise<cheerio.CheerioAPI>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaBerriSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.MOST_VIEWED, title: "Most Viewed", type: DiscoverSectionType.featured },
      { id: SECTIONS.WEEKLY, title: "Top Weekly", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.SHOUNEN, title: "Top Shounen", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.LATEST, title: "Latest Update", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.SEINEN, title: "Top Seinen", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTIONS.POPULAR_TODAY,
        title: "Popular Today",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: SECTIONS.MANHWA_MANHUA,
        title: "Top Manhwa/Manhua",
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
      case SECTIONS.MOST_VIEWED:
        return {
          items: toFeaturedItems(
            parseCarouselSection(await this.getHome(), HOME_TITLES.MOST_VIEWED),
          ),
        };
      case SECTIONS.WEEKLY:
        return this.getRankedSection(`${getBaseUrl()}/weekly-manga.php`);
      case SECTIONS.SHOUNEN:
        return this.getRankedSection(this.genreUrl(RANKED_GENRES.SHOUNEN));
      case SECTIONS.LATEST:
        return { items: toLatestItems(parseLatestSection(await this.getHome())) };
      case SECTIONS.SEINEN:
        return this.getRankedSection(this.genreUrl(RANKED_GENRES.SEINEN));
      case SECTIONS.POPULAR_TODAY:
        return {
          items: toRatedChapterItems(
            parseCarouselSection(await this.getHome(), HOME_TITLES.POPULAR_TODAY),
          ),
        };
      case SECTIONS.MANHWA_MANHUA:
        return this.getRankedSection(this.genreUrl(RANKED_GENRES.MANHWA_MANHUA));
      case SECTIONS.GENRES:
        return { items: this.genreChipItems() };
      default:
        return { items: [] };
    }
  }

  private async getRankedSection(url: string): Promise<PagedResults<DiscoverSectionItem>> {
    return { items: toRankedItems(parseListingCards(await fetchHtml(url))) };
  }

  // Genre browse keeps the slash in "Manhwa/Manhua" literal (the server expects
  // it), while spaces in names like "Martial Arts" are still encoded.
  private genreUrl(name: string): string {
    return `${getBaseUrl()}/genre.php?genre=${encodeURIComponent(name).replace(/%2F/gi, "/")}`;
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
    return new MangaBerriAdvancedSearchForm(query);
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
        ? this.genreUrl(this.genreName(genreId))
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

export const MangaBerri = new MangaBerriExtension();
