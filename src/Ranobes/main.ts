/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
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

import { RanobesAdvancedSearchForm } from "./forms";
import {
  DISCOVER_SECTIONS,
  PAGE_SIZE,
  SECTION_ALL_TIME,
  SECTION_FEATURED,
  SECTION_LATEST,
  SECTION_MOST_RATED,
  SECTION_MOST_VIEWED,
  SORTING_OPTIONS,
  type FilterTaxonomy,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import {
  fetchChapterList,
  fetchFilter,
  fetchHomepage,
  fetchHtml,
  fetchListing,
  RanobesInterceptor,
} from "./network";
import {
  extractNovelId,
  hasNextPage,
  parseChapterDetails,
  parseChapterPage,
  parseChapters,
  parseFilterTaxonomy,
  parseLatestUpdates,
  parseListings,
  parseMangaDetails,
  parseSearchResults,
  toFeaturedItem,
  toRankingItem,
} from "./parsers";
import type RanobesConfig from "./pbconfig";

export class RanobesExtension implements ExtensionImpl<typeof RanobesConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 2,
    bufferInterval: 1,
    ignoreImages: true,
  });

  mainInterceptor = new RanobesInterceptor("main");

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  private taxonomyPromise?: Promise<FilterTaxonomy>;

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    this.taxonomyPromise = undefined;
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

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    switch (section.id) {
      case SECTION_FEATURED:
        return {
          items: parseListings(await fetchHomepage(), "stories").map(toFeaturedItem),
        };
      case SECTION_LATEST: {
        const html = await fetchListing("/updates/", page);
        return {
          items: parseLatestUpdates(html),
          metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
        };
      }
      case SECTION_MOST_VIEWED:
        return this.getRankingItems("/ranking/", page, false);
      case SECTION_MOST_RATED:
        return this.getRankingItems("/ranking/rated/", page, true);
      case SECTION_ALL_TIME:
        return this.getRankingItems("/ranking/all_time/", page, false);
      default:
        return { items: [] };
    }
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    this.taxonomyPromise ??= fetchListing("/novels/").then(parseFilterTaxonomy);
    return new RanobesAdvancedSearchForm(query, await this.taxonomyPromise);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = query.title.trim();
    const filterPath = buildFilterPath(title, query.metadata, sortingOption);
    const html = filterPath
      ? await fetchFilter(filterPath, page)
      : await fetchListing("/novels/", page);
    return {
      items: parseSearchResults(html),
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseMangaDetails(await fetchHtml(mangaId), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const novelId = extractNovelId(sourceManga.mangaId);
    const firstPage = parseChapterPage(await fetchChapterList(novelId));
    const pageCount = Math.max(1, firstPage.pages_count ?? 1);
    const laterPages = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, index) =>
        fetchChapterList(novelId, index + 2).then(parseChapterPage),
      ),
    );
    return parseChapters([firstPage, ...laterPages], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    return parseChapterDetails(await fetchHtml(chapter.chapterId), chapter);
  }

  private async getRankingItems(
    path: string,
    page: number,
    useRating: boolean,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const html = await fetchListing(path, page);
    return {
      items: parseListings(html, "rankings").map((card, index) =>
        toRankingItem(card, index + (page - 1) * PAGE_SIZE, useRating),
      ),
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }
}

export const buildFilterPath = (
  title: string,
  metadata: SearchMetadata | undefined,
  sortingOption: SortingOption | undefined,
): string | undefined => {
  const segments: string[] = [];
  const add = (key: string, value: string | undefined) => {
    if (value) segments.push(`${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`);
  };
  const selections = (
    values: Record<string, "included" | "excluded"> | undefined,
    state: "included" | "excluded",
  ) =>
    Object.entries(values ?? {})
      .filter(([, value]) => value === state)
      .map(([id]) => {
        try {
          return decodeURIComponent(id);
        } catch {
          return id;
        }
      })
      .join(",");

  add("l.title", title);
  add("n.genre", selections(metadata?.genres, "included"));
  add("v.genre", selections(metadata?.genres, "excluded"));
  add("n.events", selections(metadata?.events, "included"));
  add("v.events", selections(metadata?.events, "excluded"));
  add("b.languages", selections(metadata?.languages, "included"));
  add("v.languages", selections(metadata?.languages, "excluded"));
  add("f.year", metadata?.yearFrom);
  add("t.year", metadata?.yearTo);
  add(
    "status-trs",
    metadata?.translationStatus && metadata.translationStatus !== "any"
      ? metadata.translationStatus
      : undefined,
  );
  add(
    "status-end",
    metadata?.originalStatus && metadata.originalStatus !== "any"
      ? metadata.originalStatus
      : undefined,
  );
  add("f.chap-num", metadata?.chaptersFrom);
  add("t.chap-num", metadata?.chaptersTo);
  add("f.pvotenum", metadata?.ratingsFrom);
  add("t.pvotenum", metadata?.ratingsTo);
  add("n.authors", metadata?.authors);
  add("v.authors", metadata?.excludedAuthors);
  add("n.translater", metadata?.translators);
  add("v.translater", metadata?.excludedTranslators);
  add("n.l.tags", metadata?.publishers);
  add("!m.tags", metadata?.excludedPublishers);
  if (metadata?.onlyTranslated) add("g.translater", "1");
  if (metadata?.mtlFiles || metadata?.mtlReader) add("g.mtl_files", "1");
  if (metadata?.aiTranslated) add("b.mtl-ai-translator", "DeepSeek,LLaMA 4,Gemini Flash,Mistral");

  const sortValues: Record<string, [string, string?]> = {
    rating: ["rating", "desc"],
    title_asc: ["title", "asc"],
    date_desc: ["date", "desc"],
    date_asc: ["date", "asc"],
    comments_desc: ["comm_num", "desc"],
    comments_asc: ["comm_num", "asc"],
    views_desc: ["news_read", "desc"],
    views_asc: ["news_read", "asc"],
    chapters_desc: ["d.chap-num", "desc"],
    chapters_asc: ["d.chap-num", "asc"],
    year_desc: ["d.year", "desc"],
    year_asc: ["d.year", "asc"],
    modified_desc: ["editdate", "desc"],
  };
  const sorting = sortingOption ? sortValues[sortingOption.id] : undefined;
  if (sorting) {
    add("sort", sorting[0]);
    add("order", sorting[1]);
  }
  return segments.length > 0 ? `/f/${segments.join("/")}/` : undefined;
};

export const Ranobes = new RanobesExtension();
