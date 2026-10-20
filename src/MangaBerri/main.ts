/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
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
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { getBaseUrl, MangaBerriAdvancedSearchForm, MangaBerriSettingsForm } from "./forms";
import {
  DISCOVER_SECTIONS,
  GENRES,
  SECTIONS,
  SORTING_OPTIONS,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { browseUrl, fetchHtml, MangaBerriInterceptor } from "./network";
import {
  contentRatingForGenres,
  parseBrowsePage,
  parseChapters,
  parseMangaDetails,
  parsePages,
  parsePopularCards,
  toCarouselItem,
  toFeaturedItem,
  toProminentItem,
  toSearchResultItem,
} from "./parsers";
import type MangaBerriConfig from "./pbconfig";

export class MangaBerriExtension implements ExtensionImpl<typeof MangaBerriConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private interceptor = new MangaBerriInterceptor("main");

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaBerriSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.MOST_READ:
        return { items: await this.getMostReadSectionItems() };
      case SECTIONS.POPULAR:
        return { items: await this.getPopularSectionItems() };
      case SECTIONS.LATEST:
        return this.getLatestSectionItems(metadata);
      case SECTIONS.GENRES:
        return { items: this.getGenreSectionItems() };
      default:
        return { items: [] };
    }
  }

  // The browse page's Most read order.
  private async getMostReadSectionItems(): Promise<DiscoverSectionItem[]> {
    const { cards } = parseBrowsePage(await fetchHtml(browseUrl({ sort: "popular" }, 1)));
    return cards.map(toFeaturedItem);
  }

  // The discover page's Popular manga carousel.
  private async getPopularSectionItems(): Promise<DiscoverSectionItem[]> {
    return parsePopularCards(await fetchHtml(`${getBaseUrl()}/discover`)).map(toProminentItem);
  }

  private async getLatestSectionItems(
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const { cards, hasNextPage } = parseBrowsePage(
      await fetchHtml(browseUrl({ sort: "latest" }, page)),
    );
    return {
      items: cards.map(toCarouselItem),
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private getGenreSectionItems(): DiscoverSectionItem[] {
    return GENRES.map((genre) => ({
      type: "genresCarouselItem",
      name: genre.title,
      searchQuery: { title: "", metadata: { genre: genre.id } satisfies SearchMetadata },
      contentRating: contentRatingForGenres([genre.title]),
    }));
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MangaBerriAdvancedSearchForm(query);
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title);
    if (pasted) return { items: [pasted] };

    const page = metadata?.page ?? 1;
    const { cards, hasNextPage } = parseBrowsePage(
      await fetchHtml(
        browseUrl(
          {
            q: query.title.trim(),
            genre: GENRES.find((genre) => genre.id === query.metadata?.genre)?.title,
            status: query.metadata?.status,
            sort: sortingOption?.id,
          },
          page,
        ),
      ),
    );
    return {
      items: cards.map(toSearchResultItem),
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(query: string): Promise<SearchResultItem | undefined> {
    const host = getBaseUrl()
      .replace(/^https?:\/\//, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const slug = new RegExp(`^https?://(?:www\\.)?${host}/title/([^/?#]+)`, "i").exec(
      query.trim(),
    )?.[1];
    if (!slug) return undefined;

    const manga = await this.getMangaDetails(slug);
    return {
      mangaId: manga.mangaId,
      title: manga.mangaInfo.primaryTitle,
      imageUrl: manga.mangaInfo.thumbnailUrl,
      contentRating: manga.mangaInfo.contentRating,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchHtml(`${getBaseUrl()}/title/${mangaId}`), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(
      await fetchHtml(`${getBaseUrl()}/title/${sourceManga.mangaId}`),
      sourceManga,
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parsePages(
      await fetchHtml(`${getBaseUrl()}/read/${chapter.sourceManga.mangaId}/${chapter.chapterId}`),
      chapter,
    );
  }
}

export const MangaBerri = new MangaBerriExtension();
