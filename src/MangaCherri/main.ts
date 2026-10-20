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

import { getBaseUrl, MangaCherriAdvancedSearchForm, MangaCherriSettingsForm } from "./forms";
import {
  DISCOVER_SECTIONS,
  GENRES,
  SECTIONS,
  SORTING_OPTIONS,
  type CatalogueQuery,
  type MangaCard,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { catalogueUrl, fetchHtml, MangaCherriInterceptor } from "./network";
import {
  contentRatingForGenres,
  parseCataloguePage,
  parseChapters,
  parseHomeSection,
  parseMangaDetails,
  parsePages,
  toCarouselItem,
  toChapterUpdateItems,
  toFeaturedItem,
  toProminentItem,
  toSearchResultItem,
} from "./parsers";
import type MangaCherriConfig from "./pbconfig";

export class MangaCherriExtension implements ExtensionImpl<typeof MangaCherriConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  private interceptor = new MangaCherriInterceptor("main");

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaCherriSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.MOST_VIEWED:
        return { items: await this.getMostViewedSectionItems() };
      case SECTIONS.UNFOLDING:
        return this.getCatalogueSectionItems(
          { status: "ongoing", sort: "updated" },
          metadata,
          (cards) => cards.map(toProminentItem),
        );
      case SECTIONS.LATEST:
        return this.getCatalogueSectionItems({ sort: "updated" }, metadata, toChapterUpdateItems);
      case SECTIONS.COMPLETED:
        return this.getCatalogueSectionItems(
          { status: "completed", sort: "updated" },
          metadata,
          (cards) => cards.map(toCarouselItem),
        );
      case SECTIONS.RECENTLY_ADDED:
        return this.getCatalogueSectionItems({ sort: "added" }, metadata, (cards) =>
          cards.map(toCarouselItem),
        );
      case SECTIONS.GENRES:
        return { items: this.getGenreSectionItems() };
      default:
        return { items: [] };
    }
  }

  // The home page's own Most viewed manga grid.
  private async getMostViewedSectionItems(): Promise<DiscoverSectionItem[]> {
    const html = await fetchHtml(`${getBaseUrl()}/home`);
    return parseHomeSection(html, "Most viewed manga").map(toFeaturedItem);
  }

  private async getCatalogueSectionItems(
    query: CatalogueQuery,
    metadata: PageMetadata | undefined,
    toItems: (cards: MangaCard[]) => DiscoverSectionItem[],
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const { cards, hasNextPage } = parseCataloguePage(await fetchHtml(catalogueUrl(query, page)));
    return { items: toItems(cards), metadata: hasNextPage ? { page: page + 1 } : undefined };
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
    return new MangaCherriAdvancedSearchForm(query);
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
    const { cards, hasNextPage } = parseCataloguePage(
      await fetchHtml(
        catalogueUrl(
          {
            q: query.title.trim(),
            genre: query.metadata?.genre,
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
    return parsePages(await fetchHtml(`${getBaseUrl()}/read/${chapter.chapterId}`), chapter);
  }
}

export const MangaCherri = new MangaCherriExtension();
