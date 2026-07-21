/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  DiscoverSectionType,
  URL,
  type Chapter,
  type ChapterDetails,
  type ContentRating,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type PaperbackInterceptor,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { type AnyNode } from "domhandler";

import type { basePbConfig } from "./config";
import { getUsePostIds, MangaStreamAdvancedSearchForm, MangaStreamSettings } from "./forms";
import {
  type MangaStreamFilterMetadata,
  type MangaStreamDiscoverSection,
  type MangaStreamSearchMetadata,
  type MangaStreamSlug,
  type Months,
  type StatusTypes,
} from "./models";
import { MangaStreamInterceptor } from "./network";
import { getFilterTagsBySection, getIncludedTagBySection, MangaStreamParser } from "./parsers";

export abstract class MangaStreamGeneric implements ExtensionImpl<typeof basePbConfig> {
  abstract domain: string;
  abstract name: string;
  abstract contentRating: ContentRating;
  directoryPath: string = "manga";

  parser: MangaStreamParser = new MangaStreamParser();

  interceptor?: PaperbackInterceptor;

  language = "en";

  bypassPage = "";
  mangaSelectorAlternativeTitles = "Alternative Titles";
  mangaSelectorAuthor = "Author";
  mangaSelectorArtist = "Artist";
  mangaSelectorStatus = "Status";
  mangaTagSelectorBox = "span.mgen";

  mangaStatusTypes: StatusTypes = {
    ONGOING: "ONGOING",
    COMPLETED: "COMPLETED",
  };

  dateMonths: Months = {
    january: "January",
    february: "February",
    march: "March",
    april: "April",
    may: "May",
    june: "June",
    july: "July",
    august: "August",
    september: "September",
    october: "October",
    november: "November",
    december: "December",
  };

  featuredSection: MangaStreamDiscoverSection = {
    id: "popular",
    title: "Popular Today",
    type: DiscoverSectionType.featured,
    selectorFunc: ($: cheerio.CheerioAPI) =>
      $("div.bsx", $("h2:contains(Popular Today)")?.parent()?.next()),
    titleSelectorFunc: ($: cheerio.CheerioAPI, element: cheerio.BasicAcceptedElems<AnyNode>) =>
      $("a", element).attr("title") ?? "",
    subtitleSelectorFunc: ($: cheerio.CheerioAPI, element: cheerio.BasicAcceptedElems<AnyNode>) =>
      $("div.epxs", element).first().text().trim(),
    itemType: "featuredCarouselItem",
    enabled: true,
  };

  latestUpdatesSection: MangaStreamDiscoverSection = {
    id: "latest_updates",
    title: "Latest Updates",
    type: DiscoverSectionType.simpleCarousel,
    selectorFunc: ($: cheerio.CheerioAPI) =>
      $("div.uta", $("h2:contains(Latest Update)")?.parent()?.next()),
    titleSelectorFunc: ($: cheerio.CheerioAPI, element: cheerio.BasicAcceptedElems<AnyNode>) =>
      $("a", element).attr("title") ?? "",
    subtitleSelectorFunc: ($: cheerio.CheerioAPI, element: cheerio.BasicAcceptedElems<AnyNode>) =>
      $("li > a, div.epxs", $("div.luf, div.bigor", element)).first().text().trim(),
    itemType: "chapterUpdatesCarouselItem",
    enabled: true,
  };

  discoverSections: MangaStreamDiscoverSection[] = [
    this.featuredSection,
    this.latestUpdatesSection,
  ];

  constructor() {
    this.configureSections();
  }

  globalRateLimiter = new BasicRateLimiter("ratelimiter", {
    numberOfRequests: 10,
    bufferInterval: 1,
    ignoreImages: true,
  });

  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor = this.interceptor ?? new MangaStreamInterceptor("main", () => this.domain);
    this.interceptor.registerInterceptor();
  }

  async getSearchTags(): Promise<TagSection[]> {
    let tags: TagSection[] = Application.getState("tags") as TagSection[];
    if (tags) {
      return tags;
    }
    const request = {
      url: `${this.domain}/${this.directoryPath}/`,
      method: "GET",
    };

    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    tags = this.parser.parseTags($);
    Application.setState(tags, "tags");
    return tags;
  }

  async getAdvancedSearchForm(query: SearchQuery<MangaStreamFilterMetadata>) {
    return new MangaStreamAdvancedSearchForm(query, await this.getSearchTags());
  }

  async getSearchResults(
    query: SearchQuery<MangaStreamFilterMetadata>,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page: number = metadata?.page ?? 1;

    let urlBuilder: URL = new URL(this.domain)
      .addPathComponent(this.directoryPath)
      .setQueryItem("page", page.toString());

    if (query?.title) {
      urlBuilder = urlBuilder.setQueryItem(
        "s",
        encodeURIComponent(query?.title.replace(/[’–][a-z]*/g, "") ?? ""),
      );
    } else {
      const includedTags: string[] = [];
      for (const tags of Object.values(query.metadata ?? {})) {
        if (!tags || typeof tags !== "object") continue;
        includedTags.push(...Object.keys(tags));
      }
      urlBuilder = urlBuilder
        .setQueryItem("genre", getFilterTagsBySection("genres", includedTags, true))
        .setQueryItem("status", getIncludedTagBySection("status", includedTags))
        .setQueryItem("type", getIncludedTagBySection("type", includedTags))
        .setQueryItem("order", getIncludedTagBySection("order", includedTags));
    }

    const request = {
      url: urlBuilder.toString(),
      method: "GET",
    };
    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const results = this.parser.parseSearchResults($);

    const manga: SearchResultItem[] = [];
    for (const result of results) {
      let mangaId: string = result.mangaId;
      if (getUsePostIds()) {
        mangaId = await this.slugToPostId(result.mangaId, result.path);
      }

      manga.push({
        mangaId,
        title: result.title,
        subtitle: result.subtitle,
        imageUrl: result.imageUrl,
      });
    }

    metadata = !this.parser.isLastPage($, "view_more") ? { page: page + 1 } : undefined;
    return {
      items: manga,
      metadata,
    };
  }

  supportsTagExclusion(): boolean {
    return false;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const request: Request = {
      url: getUsePostIds()
        ? `${this.domain}/?p=${mangaId}/`
        : `${this.domain}/${this.directoryPath}/${mangaId}/`,
      method: "GET",
    };
    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    return this.parser.parseMangaDetails($, mangaId, this);
  }
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const request = {
      url: getUsePostIds()
        ? `${this.domain}/?p=${sourceManga.mangaId}/`
        : `${this.domain}/${this.directoryPath}/${sourceManga.mangaId}/`,
      method: "GET",
    };

    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    return this.parser.parseChapterList($, sourceManga, this);
  }
  async getChapterDetails(chap: Chapter): Promise<ChapterDetails> {
    const request = {
      url: getUsePostIds()
        ? `${this.domain}/?p=${chap.sourceManga.mangaId}/`
        : `${this.domain}/${this.directoryPath}/${chap.sourceManga.mangaId}/`,
      method: "GET",
    };

    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    const chapters = $("div#chapterlist").find("li").toArray();
    if (chapters.length === 0) {
      throw new Error(
        `Unable to fetch chapter list for manga with mangaId: ${chap.sourceManga.mangaId}`,
      );
    }

    const chapter = chapters.find((x) => $(x).attr("data-num") === chap.chapterId);
    if (!chapter) {
      throw new Error(`Unable to fetch a chapter for chapter number: ${chap.chapterId}`);
    }

    const id = $("a", chapter).attr("href") ?? "";
    if (!id) {
      throw new Error(`Unable to fetch id for chapter with chapter id: ${chap.chapterId}`);
    }
    const chapterRequest: Request = {
      url: id,
      method: "GET",
    };

    const [, chapterBuffer] = await Application.scheduleRequest(chapterRequest);
    const chapterPage = cheerio.load(Application.arrayBufferToUTF8String(chapterBuffer));

    return this.parser.parseChapterDetails(chapterPage, chap);
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return this.discoverSections
      .filter((x: MangaStreamDiscoverSection) => x.enabled)
      .map((x: MangaStreamDiscoverSection) => {
        return {
          id: x.id,
          subtitle: x.subtitle,
          type: x.type,
          title: x.title,
        };
      });
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const request = {
      url: this.domain,
      method: "GET",
    };

    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    let s: MangaStreamDiscoverSection;
    switch (section.id) {
      case "featured":
      case "popular":
        s = this.featuredSection;
        break;
      case "latest_updates":
      default:
        s = this.latestUpdatesSection;
        break;
    }

    return {
      items: await this.parser.parseHomeSection($, s, this),
      metadata,
    };
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaStreamSettings(this.name);
  }

  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
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

  async slugToPostId(slug: string, path: string): Promise<string> {
    if ((await Application.getState(slug)) == null) {
      const postId = await this.convertSlugToPostId(slug, path);

      const existingMappedSlug = await Application.getState(postId);
      if (existingMappedSlug != null) {
        Application.setState(undefined, slug);
      }

      Application.setState(postId, slug);
      Application.setState(slug, postId);
    }

    const postId = Application.getState(slug) as string;
    if (!postId) {
      throw new Error(`Unable to fetch postId for slug:${slug}`);
    }

    return postId;
  }

  async convertPostIdToSlug(postId: number): Promise<MangaStreamSlug> {
    const request = {
      url: `${this.domain}/?p=${postId}`,
      method: "GET",
    };

    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    let parseSlug: string;
    parseSlug = String($('meta[property="og:url"]').attr("content"));

    if (!parseSlug.includes(this.domain)) {
      parseSlug = String($('link[rel="canonical"]').attr("href"));
    }

    if (!parseSlug || !parseSlug.includes(this.domain)) {
      throw new Error("Unable to parse slug!");
    }

    const parseSlugArr = parseSlug.replace(/\/$/, "").split("/");

    const slug: string = parseSlugArr.slice(-1).pop() as string;
    const path: string = parseSlugArr.slice(-2).shift() as string;

    return {
      path,
      slug,
    };
  }

  async convertSlugToPostId(slug: string, path: string): Promise<string> {
    const headRequest = {
      url: `${this.domain}/${path}/${slug}/`,
      method: "HEAD",
    };
    const [headResponse] = await Application.scheduleRequest(headRequest);
    const headerPostId = headResponse.headers.Link?.match(/\?p=(\d+)/)?.[1];
    if (headerPostId) return headerPostId;

    const request = {
      url: `${this.domain}/${path}/${slug}/`,
      method: "GET",
    };

    const [, buffer] = await Application.scheduleRequest(request);
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    let postIdNum = Number($('link[rel="shortlink"]')?.attr("href")?.split("/?p=")[1]);

    if (isNaN(postIdNum)) {
      postIdNum = Number($("div.bookmark").attr("data-id"));
    }

    if (isNaN(postIdNum)) {
      const page = $.root().html();
      const match = page?.match(/postID.*\D(\d+)/);
      if (match != null && match[1]) {
        postIdNum = Number(match[1]?.trim());
      }
    }

    if (!postIdNum || isNaN(postIdNum)) {
      throw new Error(`Unable to fetch numeric postId for this item! (path:${path} slug:${slug})`);
    }

    return postIdNum.toString();
  }

  configureSections(): void {}
}
