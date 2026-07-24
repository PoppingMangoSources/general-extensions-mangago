/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
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
} from "@paperback/types";

import { LuaComicAdvancedSearchForm } from "./forms/search";
import { getShowAdultContent, getShowPaidChapters, LuaComicSettingsForm } from "./forms/settings";
import {
  API_URL,
  DOMAIN,
  FALLBACK_GENRES,
  PAGE_SIZE,
  SECTIONS,
  SORTING_OPTIONS,
  TRENDING_RANGES,
  type LuaHomePage,
  type LuaQueryResponse,
  type LuaSeries,
  type LuaTrendingItem,
  type OptionItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchJSON, fetchTags, fetchText, LuaComicInterceptor } from "./network";
import {
  parseChapterList,
  parseChapterPages,
  parseHomePage,
  parseMangaDetails,
  tagNames,
  toBannerItems,
  toLatestItems,
  toPopularItems,
  toRankedItems,
  toRecommendedItems,
  toSearchResultItems,
} from "./parsers";
import type LuaComicConfig from "./pbconfig";

export class LuaComicExtension implements ExtensionImpl<typeof LuaComicConfig> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 15,
    bufferInterval: 10,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  private interceptor = new LuaComicInterceptor("main");

  private homePagePromise?: Promise<LuaHomePage>;
  private genresPromise?: Promise<OptionItem[]>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new LuaComicSettingsForm();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.homePagePromise = undefined;
    this.genresPromise = undefined;
    for (const cookie of cookies) {
      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTIONS.POPULAR, title: "Most Popular", type: DiscoverSectionType.featured },
      { id: SECTIONS.FEATURED, title: "Featured", type: DiscoverSectionType.featured },
      {
        id: SECTIONS.RECOMMENDED,
        title: "Recommended",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTIONS.LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTIONS.TRENDING, title: "Trending", type: DiscoverSectionType.genres },
      { id: SECTIONS.EDITORS, title: "Editor's Choice", type: DiscoverSectionType.simpleCarousel },
      { id: SECTIONS.GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case SECTIONS.POPULAR: {
        const data = await this.fetchQuery({ page: 1, orderBy: "total_views" });
        return { items: toPopularItems(data.data ?? []), metadata: undefined };
      }
      case SECTIONS.FEATURED: {
        const home = await this.getHomePage();
        return { items: toBannerItems(home.banners), metadata: undefined };
      }
      case SECTIONS.RECOMMENDED: {
        const home = await this.getHomePage();
        return { items: toRecommendedItems(home.recommended), metadata: undefined };
      }
      case SECTIONS.LATEST: {
        const page = metadata?.page ?? 1;
        const data = await this.fetchQuery({ page, orderBy: "updated_at" });
        const hasNext = (data.meta?.last_page ?? 1) > page;
        return {
          items: toLatestItems(data.data ?? []),
          metadata: hasNext ? { page: page + 1 } : undefined,
        };
      }
      case SECTIONS.TRENDING:
        return {
          items: TRENDING_RANGES.map((range) => ({
            type: "genresCarouselItem",
            name: range.title,
            searchQuery: {
              title: "",
              metadata: { trending: range.id } satisfies SearchMetadata,
            },
            metadata: undefined,
          })),
          metadata: undefined,
        };
      case SECTIONS.EDITORS: {
        const home = await this.getHomePage();
        return { items: toRankedItems(home.editors), metadata: undefined };
      }
      case SECTIONS.GENRES: {
        const genres = await this.getGenreOptions();
        return {
          items: genres.map((genre) => ({
            type: "genresCarouselItem",
            name: genre.value,
            searchQuery: {
              title: "",
              metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
            },
            metadata: undefined,
          })),
          metadata: undefined,
        };
      }
      default:
        return { items: [], metadata: undefined };
    }
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new LuaComicAdvancedSearchForm(query, await this.getGenreOptions());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const pasted = await this.resolveUrlQuery(query.title ?? "");
    if (pasted) return pasted;

    const trending = query.metadata?.trending;
    if (trending) {
      const url = new URL(API_URL)
        .addPathComponent("trending")
        .setQueryItem("type", trending)
        .toString();
      const entries = await fetchJSON<LuaTrendingItem[]>(url);
      return {
        items: entries.map((entry, index) => {
          const chapters = parseInt(String(entry.meta?.chapters_count ?? ""), 10);
          const subtitle = [`#${index + 1}`, Number.isFinite(chapters) ? `${chapters} ch` : ""]
            .filter(Boolean)
            .join(" • ");
          return {
            mangaId: entry.series_slug,
            title: entry.title,
            imageUrl: entry.thumbnail ?? "",
            subtitle,
            contentRating: ContentRating.MATURE,
          };
        }),
        metadata: undefined,
      };
    }

    const page = metadata?.page ?? 1;
    const meta = query.metadata;
    const excluded = new Set(
      Object.entries(meta?.genres ?? {})
        .filter(([, state]) => state === "excluded")
        .map(([id]) => id.toLowerCase()),
    );

    const data = await this.fetchQuery({
      page,
      search: (query.title ?? "").trim() || undefined,
      orderBy: sortingOption?.id,
      status: meta?.status?.[0],
      genres: Object.entries(meta?.genres ?? {})
        .filter(([, state]) => state === "included")
        .map(([id]) => id),
    });

    const entries = (data.data ?? []).filter(
      (series) =>
        excluded.size === 0 || !tagNames(series).some((name) => excluded.has(name.toLowerCase())),
    );
    const hasNext = (data.meta?.last_page ?? 1) > page;

    return {
      items: toSearchResultItems(entries),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const slug = query.trim().match(/^https?:\/\/(?:www\.)?luacomic\.org\/series\/([^/?#]+)/i)?.[1];
    if (!slug) return undefined;

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
      metadata: undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await this.fetchSeries(mangaId));
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const series = await this.fetchSeries(sourceManga.mangaId);
    return parseChapterList(series, sourceManga, getShowPaidChapters());
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await fetchText(
      `${DOMAIN}/series/${chapter.sourceManga.mangaId}/${chapter.chapterId}`,
    );
    return parseChapterPages(html, chapter);
  }

  private async fetchSeries(slug: string): Promise<LuaSeries> {
    const url = new URL(API_URL)
      .addPathComponent("query")
      .setQueryItem("series_slug", slug)
      .setQueryItem("page", "1")
      .setQueryItem("perPage", "1")
      .setQueryItem("adult", "true")
      .toString();
    const data = await fetchJSON<LuaQueryResponse>(url);
    const series = data.data?.[0];
    if (!series) throw new Error(`Series not found: ${slug}`);
    return series;
  }

  private getHomePage(): Promise<LuaHomePage> {
    this.homePagePromise ??= fetchText(`${DOMAIN}/`).then(parseHomePage);
    return this.homePagePromise;
  }

  private getGenreOptions(): Promise<OptionItem[]> {
    this.genresPromise ??= fetchTags()
      .then((tags) => (tags.length > 0 ? tags : FALLBACK_GENRES))
      .catch(() => FALLBACK_GENRES);
    return this.genresPromise;
  }

  private async fetchQuery(opts: {
    page: number;
    search?: string;
    orderBy?: string;
    status?: string;
    genres?: string[];
  }): Promise<LuaQueryResponse> {
    const builder = new URL(API_URL)
      .addPathComponent("query")
      .setQueryItem("page", opts.page.toString())
      .setQueryItem("perPage", PAGE_SIZE.toString())
      .setQueryItem("series_type", "Comic")
      .setQueryItem("adult", getShowAdultContent() ? "true" : "false")
      .setQueryItem("orderBy", opts.orderBy ?? "created_at")
      .setQueryItem("status", opts.status ?? "All");

    if (opts.search) builder.setQueryItem("query_string", opts.search);

    const numericIds = (opts.genres ?? []).filter((id) => /^\d+$/.test(id));
    builder.setQueryItem("tags_ids", `[${numericIds.join(",")}]`);

    return fetchJSON<LuaQueryResponse>(builder.toString());
  }
}

export const LuaComic = new LuaComicExtension();
