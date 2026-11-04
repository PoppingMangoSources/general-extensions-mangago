/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
  CookieStorageInterceptor,
  DiscoverSectionType,
  URL,
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
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { MGReadAdvancedSearchForm } from "./forms/search";
import { getPreferences, MGReadSettingsForm } from "./forms/settings";
import {
  DOMAIN,
  PAGE_SIZE,
  SECTIONS,
  SORT_OPTIONS,
  TOP_OPTIONS,
  type MangaListItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  applyContentFilters,
  buildBrowseUrl,
  fetchChapterPage,
  fetchContentPage,
  fetchHtml,
  fetchJSON,
  fetchReaderPage,
  fetchSearchPage,
  MGReadInterceptor,
} from "./network";
import {
  hasNextPage,
  isLocked,
  parseChapterPages,
  parseChapters,
  parseGenres,
  parseMangaDetails,
  parseMangaList,
  parseSearchItems,
  pathId,
} from "./parsers";
import type MGReadConfig from "./pbconfig";
class MGReadExtension implements ExtensionImpl<typeof MGReadConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new MGReadInterceptor("main");
  private genresPromise?: Promise<Tag[]>;
  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }
  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _storage: Record<string, string>,
  ): Promise<void> {
    this.genresPromise = undefined;
    for (const cookie of cookies)
      if (/^_{0,2}cf/.test(cookie.name)) this.cookieStorageInterceptor.setCookie(cookie);
  }
  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchHtml(`${DOMAIN}/advanced-filter/`)
      .then(parseGenres)
      .catch((error: unknown) => {
        this.genresPromise = undefined;
        throw error;
      }));
  }
  async getSettingsForm(): Promise<Form> {
    return new MGReadSettingsForm(await this.getGenres());
  }
  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new MGReadAdvancedSearchForm(query, await this.getGenres());
  }
  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.featured },
      { id: SECTIONS.RATED, title: "Top Rated", type: DiscoverSectionType.prominentCarousel },
      { id: SECTIONS.TOP, title: "Top Manga", type: DiscoverSectionType.genres },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.FOLLOWS, title: "Top Follows", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.POWER, title: "Power Ranking", type: DiscoverSectionType.simpleCarousel },
    ];
  }
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.TOP)
      return {
        items: TOP_OPTIONS.map((option) => ({
          type: "genresCarouselItem",
          name: option.title,
          searchQuery: { title: "", metadata: { topWindow: option.id } satisfies SearchMetadata },
        })),
      };
    const paths: Record<string, string> = {
      [SECTIONS.POPULAR]: "manga-ranking",
      [SECTIONS.RATED]: "top-rated-manga",
      [SECTIONS.LATEST]: "recently-updated",
      [SECTIONS.FOLLOWS]: "top-follow",
      [SECTIONS.POWER]: "power-ranking",
    };
    const path = paths[section.id];
    if (!path) return { items: [] };
    const page = metadata?.page ?? 1;
    const document = await fetchHtml(
      new URL(DOMAIN).setPath(`${path}/${page > 1 ? `page/${page}/` : ""}`).toString(),
    );
    const raw = parseMangaList(document);
    const preferences = getPreferences();
    const allowed = await applyContentFilters(raw, preferences);
    const items = allowed.flatMap((item): DiscoverSectionItem[] => {
      const summary = [
        item.rating ? `${item.rating}/5` : "",
        item.latest?.number !== undefined ? `Ch. ${item.latest.number}` : "",
        item.follows && section.id === SECTIONS.FOLLOWS ? `${item.follows} follows` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const base = {
        mangaId: item.id,
        title: item.title,
        imageUrl: item.cover,
        contentRating: item.contentRating,
      };
      if (section.id === SECTIONS.POPULAR) {
        const info:
          | [{ symbol: string; text: string }]
          | [{ symbol: string; text: string }, { symbol: string; text: string }]
          | undefined =
          item.views && summary
            ? [
                { symbol: "eye.fill", text: `${item.views} views` },
                { symbol: "star.fill", text: summary },
              ]
            : item.views
              ? [{ symbol: "eye.fill", text: `${item.views} views` }]
              : summary
                ? [{ symbol: "star.fill", text: summary }]
                : undefined;
        return [
          {
            ...base,
            type: "featuredCarouselItem",
            supertitle: `#${(page - 1) * PAGE_SIZE + raw.findIndex((original) => original.id === item.id) + 1}`,
            summary: item.summary,
            infoItems: info,
          },
        ];
      }
      if (section.id === SECTIONS.LATEST)
        return item.latest
          ? [
              {
                ...base,
                type: "chapterUpdatesCarouselItem",
                chapterId: item.latest.id,
                subtitle:
                  item.latest.number === undefined ? undefined : `Ch. ${item.latest.number}`,
                publishDate: item.latest.date,
              },
            ]
          : [];
      return [
        {
          ...base,
          type: section.id === SECTIONS.RATED ? "prominentCarouselItem" : "simpleCarouselItem",
          subtitle: summary || undefined,
        },
      ];
    });
    return { items, ...(hasNextPage(document) ? { metadata: { page: page + 1 } } : {}) };
  }
  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1,
      preferences = getPreferences(),
      meta = query.metadata ?? {};
    const term = (query.title ?? "").trim();
    if (/^https?:\/\/(?:www\.)?mgread\.io\/manga\/[^/?#]+\/?$/i.test(term)) {
      try {
        const id = pathId(term),
          manga = parseMangaDetails(await fetchContentPage(id), id);
        return {
          items: [
            {
              mangaId: id,
              title: manga.mangaInfo.primaryTitle,
              imageUrl: manga.mangaInfo.thumbnailUrl,
              contentRating: manga.mangaInfo.contentRating,
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof CloudflareError) throw error;
        return { items: [] };
      }
    }
    let items: MangaListItem[];
    let next = false;
    if (meta.topWindow) {
      if (page > 1) return { items: [] };
      const response = await fetchJSON<{ posts: { html: string }[] }>(
        new URL(DOMAIN)
          .setPath("wp-json/initmanga/v1/top-ranking")
          .setQueryItem("range", meta.topWindow)
          .toString(),
      );
      items = parseMangaList(cheerio.load(response.posts.map((post) => post.html).join("")));
    } else if (term) {
      const result = await fetchSearchPage(term, page);
      items = parseSearchItems(result);
      next = result.length === 10;
    } else {
      const document = await fetchHtml(buildBrowseUrl(page, sortingOption?.id ?? "updated", meta));
      items = parseMangaList(document);
      next = hasNextPage(document);
    }
    const filtered = await applyContentFilters(items, preferences);
    return {
      items: filtered.map((item) => ({
        mangaId: item.id,
        title: item.title,
        imageUrl: item.cover,
        contentRating: item.contentRating,
        subtitle:
          [
            meta.topWindow
              ? `#${(page - 1) * PAGE_SIZE + items.findIndex((raw) => raw.id === item.id) + 1}`
              : "",
            item.latest?.number !== undefined ? `Ch. ${item.latest.number}` : "",
            item.views ? `${item.views} views` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      })),
      ...(next ? { metadata: { page: page + 1 } } : {}),
    };
  }
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchContentPage(mangaId), mangaId);
  }
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const document = await fetchContentPage(sourceManga.mangaId),
      id = document("#manga-title").attr("data-id");
    if (!id) throw new Error("MGRead did not provide this title's chapter index.");
    const first = await fetchChapterPage(id, 1);
    const entries = [...first.items];
    for (let page = 2; page <= first.total_pages; page += 3) {
      const pages = await Promise.all(
        Array.from({ length: Math.min(3, first.total_pages - page + 1) }, (_, i) =>
          fetchChapterPage(id, page + i),
        ),
      );
      for (const result of pages) entries.push(...result.items);
    }
    const preferences = getPreferences();
    return parseChapters(
      entries.filter((entry) => !preferences.hideLocked || !isLocked(entry)),
      sourceManga,
    );
  }
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterPages(await fetchReaderPage(chapter.chapterId), chapter);
  }
}
export const MGRead = new MGReadExtension();
