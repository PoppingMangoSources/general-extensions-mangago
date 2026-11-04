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

import { formatCount } from "../utils/listings";
import { SwarmAdvancedSearchForm } from "./forms/search";
import { getPreferences, SwarmSettingsForm } from "./forms/settings";
import {
  DOMAIN,
  PAGE_SIZE,
  SECTIONS,
  SORT_OPTIONS,
  WINDOW_OPTIONS,
  type Preferences,
  type SearchMetadata,
  type PageMetadata,
  type MangaListResponse,
  type HomepageResponse,
  type NovelResponse,
  type NovelChapterResponse,
  type SwarmManga,
} from "./models";
import {
  buildSearchUrl,
  fetchJSON,
  fetchComicPage,
  fetchChapterPages,
  fetchLatest,
  SwarmInterceptor,
} from "./network";
import {
  chapterLabel,
  coverOf,
  encodeId,
  idOf,
  isAllowed,
  novelXHTML,
  parseChapterPages,
  parseChapters,
  parseDate,
  parseMangaDetails,
  ratingFor,
  titleOf,
  toSearchItem,
} from "./parsers";
import type SwarmConfig from "./pbconfig";
class SwarmExtension implements ExtensionImpl<typeof SwarmConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new SwarmInterceptor("main");
  private genresPromise?: Promise<Tag[]>;
  private typesPromise?: Promise<Tag[]>;
  private tagsPromise?: Promise<Tag[]>;
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
    this.typesPromise = undefined;
    this.tagsPromise = undefined;
    for (const cookie of cookies)
      if (/^_{0,2}cf/.test(cookie.name)) this.cookieStorageInterceptor.setCookie(cookie);
  }
  private getGenres(): Promise<Tag[]> {
    return (this.genresPromise ??= fetchJSON<{ genres: string[] }>(`${DOMAIN}/api/manga/genres`)
      .then((data) => data.genres.map((title) => ({ id: encodeId(title), title })))
      .catch((error: unknown) => {
        this.genresPromise = undefined;
        throw error;
      }));
  }
  async getSettingsForm(): Promise<Form> {
    return new SwarmSettingsForm();
  }
  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    const [genres, types, tags] = await Promise.all([
      this.getGenres(),
      (this.typesPromise ??= fetchJSON<{ types: string[] }>(`${DOMAIN}/api/manga/types`)
        .then((data) => data.types.map((title) => ({ id: encodeId(title), title })))
        .catch((error: unknown) => {
          this.typesPromise = undefined;
          throw error;
        })),
      (this.tagsPromise ??= fetchJSON<{ tags: string[] }>(`${DOMAIN}/api/manga/tags`)
        .then((data) => data.tags.map((title) => ({ id: encodeId(title), title })))
        .catch((error: unknown) => {
          this.tagsPromise = undefined;
          throw error;
        })),
    ]);
    return new SwarmAdvancedSearchForm(query, genres, types, tags);
  }
  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.FOLLOWED,
        title: "Most Followed New Comics",
        type: DiscoverSectionType.genres,
      },
      { id: SECTIONS.HOT, title: "Latest Updates (Hot)", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.RANDOM, title: "Random", type: DiscoverSectionType.prominentCarousel },
      { id: SECTIONS.NEW, title: "Latest Updates (New)", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.RECENT, title: "Most Recent Popular", type: DiscoverSectionType.genres },
      { id: SECTIONS.NOVELS, title: "Novels", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }
  private async loadFeed(
    feed: string,
    page: number,
    preferences: Preferences,
    window = "7d",
  ): Promise<MangaListResponse> {
    if (feed === SECTIONS.HOT || feed === SECTIONS.NEW) return fetchLatest(page, feed, preferences);
    if (feed === SECTIONS.POPULAR || feed === SECTIONS.RECENT)
      return fetchJSON<MangaListResponse>(
        new URL(DOMAIN)
          .setPath("api/analytics/popular")
          .setQueryItem("window", feed === SECTIONS.POPULAR ? "3m" : window)
          .setQueryItem("limit", String(PAGE_SIZE))
          .setQueryItem("offset", String((page - 1) * PAGE_SIZE))
          .toString(),
      );
    if (page > 1) return { data: [], hasMore: false };
    if (feed === SECTIONS.FOLLOWED) {
      const home = await fetchJSON<HomepageResponse>(
        new URL(DOMAIN).setPath("api/homepage").setQueryItem("window", window).toString(),
      );
      return { ...home.newComics, hasMore: false };
    }
    if (feed === SECTIONS.RANDOM) {
      const result = await fetchJSON<MangaListResponse>(`${DOMAIN}/api/random?limit=20`);
      return { ...result, hasMore: false };
    }
    if (feed === SECTIONS.NOVELS) {
      const result = await fetchJSON<{ success: boolean; data: SwarmManga[] }>(
        `${DOMAIN}/api/novel`,
      );
      return { data: result.data, hasMore: false };
    }
    return { data: [], hasMore: false };
  }
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.FOLLOWED || section.id === SECTIONS.RECENT) {
      const options =
        section.id === SECTIONS.FOLLOWED
          ? WINDOW_OPTIONS
          : WINDOW_OPTIONS.filter((option) => option.id !== "3m");
      return {
        items: options.map((option) => ({
          type: "genresCarouselItem",
          name: option.title,
          searchQuery: {
            title: "",
            metadata: { feed: section.id, window: option.id } satisfies SearchMetadata,
          },
        })),
      };
    }
    if (section.id === SECTIONS.GENRES)
      return {
        items: (await this.getGenres()).map((genre) => ({
          type: "genresCarouselItem",
          name: genre.title,
          searchQuery: { title: "", metadata: { genres: [genre.id] } satisfies SearchMetadata },
        })),
      };
    const preferences = getPreferences(),
      page = metadata?.page ?? 1,
      response = await this.loadFeed(section.id, page, preferences);
    const items = response.data
      .filter((manga) => isAllowed(manga, preferences))
      .flatMap((manga): DiscoverSectionItem[] => {
        const base = {
          mangaId: idOf(manga),
          title: titleOf(manga),
          imageUrl: coverOf(manga),
          contentRating: ratingFor(manga),
        };
        if (section.id === SECTIONS.POPULAR) {
          const views = formatCount(manga.readCount ?? manga.views),
            chapters = chapterLabel(manga);
          return [
            {
              ...base,
              type: "featuredCarouselItem",
              supertitle: `#${(page - 1) * PAGE_SIZE + response.data.findIndex((raw) => raw.id === manga.id) + 1}`,
              summary: manga.description,
              infoItems:
                views && chapters
                  ? [
                      { symbol: "eye.fill", text: views },
                      { symbol: "book.fill", text: chapters },
                    ]
                  : views
                    ? [{ symbol: "eye.fill", text: views }]
                    : chapters
                      ? [{ symbol: "book.fill", text: chapters }]
                      : undefined,
            },
          ];
        }
        if (section.id === SECTIONS.HOT || section.id === SECTIONS.NEW)
          return manga.chapter_id
            ? [
                {
                  ...base,
                  type: "chapterUpdatesCarouselItem",
                  chapterId: manga.chapter_id,
                  subtitle: toSearchItem(manga).subtitle,
                  publishDate: parseDate(manga.released ?? manga.updatedAt),
                },
              ]
            : [];
        return [
          {
            ...base,
            type: section.id === SECTIONS.RANDOM ? "prominentCarouselItem" : "simpleCarouselItem",
            subtitle: toSearchItem(manga).subtitle,
          },
        ];
      });
    const more =
      response.hasMore ??
      (response.data.length > 0 &&
        (response.total ?? 0) > (page - 1) * PAGE_SIZE + response.data.length);
    return { items, ...(more ? { metadata: { page: page + 1 } } : {}) };
  }
  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1,
      term = (query.title ?? "").trim(),
      meta = query.metadata ?? {},
      preferences = getPreferences();
    const pasted = /^https?:\/\/(?:www\.)?swarm\.ws\/(comic|novels?)\/([^/?#]+)\/?$/i.exec(term);
    if (pasted) {
      try {
        const id = encodeId(`${pasted[1].startsWith("novel") ? "novel/" : ""}${pasted[2]}`);
        const details = await this.getMangaDetails(id);
        return {
          items: [
            {
              mangaId: id,
              title: details.mangaInfo.primaryTitle,
              imageUrl: details.mangaInfo.thumbnailUrl,
              contentRating: details.mangaInfo.contentRating,
            },
          ],
        };
      } catch (error: unknown) {
        if (error instanceof CloudflareError) throw error;
        return { items: [] };
      }
    }
    let result: MangaListResponse;
    if (meta.feed) result = await this.loadFeed(meta.feed, page, preferences, meta.window);
    else if (meta.catalog?.[0] === "novels") {
      result = await this.loadFeed(SECTIONS.NOVELS, page, preferences);
      result.data = result.data.filter(
        (manga) => !term || manga.title.toLowerCase().includes(term.toLowerCase()),
      );
      if (sortingOption?.id === "title") result.data.sort((a, b) => a.title.localeCompare(b.title));
      else
        result.data.sort(
          (a, b) =>
            (parseDate(b.updatedAt ?? b.createdAt)?.getTime() ?? 0) -
            (parseDate(a.updatedAt ?? a.createdAt)?.getTime() ?? 0),
        );
    } else
      result = await fetchJSON<MangaListResponse>(
        buildSearchUrl(term, page, sortingOption?.id ?? "last_updated", meta, preferences),
      );
    const effective = { ...preferences, content: meta.content?.[0] ?? preferences.content };
    const items = result.data
      .filter((manga) => isAllowed(manga, effective))
      .map((manga) => toSearchItem(manga));
    const more =
      result.hasMore ??
      (result.data.length > 0 && (result.total ?? 0) > (page - 1) * PAGE_SIZE + result.data.length);
    return { items, ...(more ? { metadata: { page: page + 1 } } : {}) };
  }
  async getMangaDetails(id: string): Promise<SourceManga> {
    const path = decodeURIComponent(id);
    if (path.startsWith("novel/")) {
      const response = await fetchJSON<NovelResponse>(
        new URL(DOMAIN).setPath(`api/novel/${path.slice(6)}`).toString(),
      );
      return parseMangaDetails(response.data, id);
    }
    return parseMangaDetails((await fetchComicPage(id)).manga, id);
  }
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const id = decodeURIComponent(sourceManga.mangaId),
      preferences = getPreferences();
    if (id.startsWith("novel/")) {
      const result = await fetchJSON<NovelResponse>(
        new URL(DOMAIN).setPath(`api/novel/${id.slice(6)}`).toString(),
      );
      return parseChapters(result.data.chapters ?? [], sourceManga, preferences);
    }
    return parseChapters(
      (await fetchComicPage(sourceManga.mangaId)).chapters,
      sourceManga,
      preferences,
    );
  }
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const id = decodeURIComponent(chapter.sourceManga.mangaId);
    if (id.startsWith("novel/")) {
      const number = chapter.chapterId.split("@")[1];
      if (!number) throw new Error("This novel chapter has no reading key.");
      const response = await fetchJSON<NovelChapterResponse>(
        new URL(DOMAIN).setPath(`api/novel/${id.slice(6)}/chapter/${number}`).toString(),
      );
      return {
        id: chapter.chapterId,
        mangaId: chapter.sourceManga.mangaId,
        type: "html",
        html: novelXHTML(response.data.content),
      };
    }
    return parseChapterPages(await fetchChapterPages(chapter.chapterId), chapter);
  }
}
export const Swarm = new SwarmExtension();
