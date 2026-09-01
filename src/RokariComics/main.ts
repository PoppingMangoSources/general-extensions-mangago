/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  URL,
  type ContentRating,
  type DiscoverSection,
  type DiscoverSectionItem,
  type Form,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { type BasicAcceptedElems, type CheerioAPI } from "cheerio";
import { type AnyNode } from "domhandler";

import { getUsePostIds } from "./generic/forms";
import { MangaStreamGeneric } from "./generic/main";
import {
  type MangaStreamDiscoverSection,
  type MangaStreamFilterMetadata,
  type MangaStreamSearchMetadata,
} from "./generic/models";
import { getFilterTagsBySection, getIncludedTagBySection } from "./generic/parsers";
import { DOMAIN, RANKING_RANGES, SECTIONS, SORT_OPTIONS } from "./models";
import { parseRelativeDate } from "./parsers";
import pbconfig from "./pbconfig";
import { getBaseUrlOverride, getShowLockedChapters, RokariComicsSettings } from "./settings";

class RokariComicsExtension extends MangaStreamGeneric {
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;

  get showLockedChapters(): boolean {
    return getShowLockedChapters();
  }

  get domain(): string {
    return getBaseUrlOverride() ?? DOMAIN;
  }

  override async getSettingsForm(): Promise<Form> {
    return new RokariComicsSettings(this.name, DOMAIN);
  }

  override async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const details = await super.getMangaDetails(mangaId);
    if (details.mangaInfo.author === "Unknown") details.mangaInfo.author = undefined;
    if (details.mangaInfo.artist === "Unknown") details.mangaInfo.artist = undefined;
    return details;
  }

  override configureSections() {
    const hero: MangaStreamDiscoverSection = {
      id: SECTIONS.FEATURED,
      title: "Featured",
      type: DiscoverSectionType.featured,
      selectorFunc: ($: CheerioAPI) => $("div.slider-wrapper div.swiper-slide"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        cleanText($("span.name", element).first().text()),
      subtitleSelectorFunc: () => "",
      itemType: "featuredCarouselItem",
      enabled: true,
    };

    const popularToday: MangaStreamDiscoverSection = {
      id: SECTIONS.POPULAR,
      title: "Popular Today",
      type: DiscoverSectionType.prominentCarousel,
      selectorFunc: ($: CheerioAPI) => $("div.popularslider div.bsx"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        cleanText($("a", element).attr("title") ?? $("div.tt", element).first().text()),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "prominentCarouselItem",
      enabled: true,
    };

    const latest: MangaStreamDiscoverSection = {
      id: SECTIONS.LATEST_UPDATES,
      title: "Latest Updates",
      type: DiscoverSectionType.chapterUpdates,
      selectorFunc: ($: CheerioAPI) => $(".bixbox:has(h2:contains(Latest)) .bs .bsx"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        cleanText($("a", element).attr("title") ?? $("div.tt", element).first().text()),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "chapterUpdatesCarouselItem",
      enabled: true,
    };

    const recommendation: MangaStreamDiscoverSection = {
      id: SECTIONS.RECOMMENDATION,
      title: "Recommendation",
      type: DiscoverSectionType.simpleCarousel,
      selectorFunc: ($: CheerioAPI) => $("div.series-gen div.listupd div.bsx"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        cleanText($("a", element).attr("title") ?? $("div.tt", element).first().text()),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "simpleCarouselItem",
      enabled: true,
    };

    const popularRanking: MangaStreamDiscoverSection = {
      id: SECTIONS.POPULAR_RANKING,
      title: "Popular",
      type: DiscoverSectionType.genres,
      selectorFunc: ($: CheerioAPI) => $(),
      titleSelectorFunc: () => "",
      subtitleSelectorFunc: () => "",
      itemType: "genresCarouselItem",
      enabled: true,
    };

    this.discoverSections = [hero, latest, popularToday, recommendation, popularRanking];
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTIONS.POPULAR_RANKING) {
      return {
        items: RANKING_RANGES.map((range) => ({
          type: "genresCarouselItem",
          name: range.title,
          searchQuery: {
            title: "",
            metadata: { rokariRange: range.id },
          },
        })),
      };
    }

    const [, buffer] = await Application.scheduleRequest({
      url: this.domain,
      method: "GET",
    });
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    switch (section.id) {
      case SECTIONS.FEATURED:
        return { items: await this.parseFeatured($), metadata };
      case SECTIONS.LATEST_UPDATES:
        return { items: await this.parseLatest($), metadata };
      case SECTIONS.RECOMMENDATION:
        return { items: await this.parseRecommendation($), metadata };
      default: {
        const configured =
          this.discoverSections.find((x) => x.id === section.id) ?? this.latestUpdatesSection;
        return { items: await this.parser.parseHomeSection($, configured, this), metadata };
      }
    }
  }

  private async resolveMangaId(href: string, relAttr?: string): Promise<string> {
    const slug = href.replace(/\/$/, "").split("/").pop() ?? "";
    if (!getUsePostIds()) return slug;
    const path = href.replace(/\/$/, "").split("/").slice(-2).shift() ?? "";
    return relAttr && !isNaN(Number(relAttr)) ? relAttr : await this.slugToPostId(slug, path);
  }

  private async parseFeatured($: CheerioAPI): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];
    for (const slide of $("div.slider-wrapper div.swiper-slide").toArray()) {
      const anchor = $("a", slide).first();
      const href = anchor.attr("href") ?? "";
      const title = cleanText($("span.name", slide).first().text());
      if (!href || !title) continue;

      const mangaId = await this.resolveMangaId(href, anchor.attr("rel"));
      if (!mangaId) continue;

      const imageUrl = this.parser.getImageSrc($("img", slide)) ?? "";
      if (!imageUrl) continue;

      const chapterLabel = (
        $("span.chapter, div.chapter, span.fivchap, span.epxs, div.epxs", slide).first().text() ||
        ($(slide)
          .text()
          .match(/(?:Chapter|Ch\.?)\s*[\d.]+/i)?.[0] ??
          "")
      )
        .replace(/\s+/g, " ")
        .trim();

      items.push({
        type: "featuredCarouselItem",
        mangaId,
        imageUrl,
        title,
        infoItems: chapterLabel ? [{ symbol: "book.fill", text: chapterLabel }] : undefined,
      });
    }
    return items;
  }

  private async parseLatest($: CheerioAPI): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];
    for (const element of $(".bixbox:has(h2:contains(Latest)) .bs .bsx").toArray()) {
      const seriesAnchor = $("a[href*='/manga/']", element).first();
      const href = seriesAnchor.attr("href") ?? "";
      const title = cleanText(
        seriesAnchor.attr("title") ?? $("div.tt a, div.tt", element).first().text(),
      );
      if (!href || !title) continue;

      const mangaId = await this.resolveMangaId(href, seriesAnchor.attr("rel"));
      if (!mangaId) continue;

      const imageUrl = this.parser.getImageSrc($("img", element)) ?? "";

      const chapterAnchor = $("ul.chfiv li a", element).first();
      const chapterLabel = $("span.fivchap", chapterAnchor)
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      const chapterId =
        chapterLabel.match(/([\d.]+)\s*$/)?.[1] ??
        (chapterAnchor.attr("href") ?? "")
          .match(/chapter-(\d+(?:-\d+)?)\/?$/)?.[1]
          ?.replace(/-/g, ".") ??
        "";
      if (!chapterId) continue;

      const timeEl = $("span.fivtime", chapterAnchor).first();
      const isNew = timeEl.hasClass("new-chapter");
      const rawTime = timeEl.clone().children().remove().end().text().replace(/\s+/g, " ").trim();
      const ageText = isNew ? "NEW" : rawTime ? `${rawTime} ago` : "";

      items.push({
        type: "chapterUpdatesCarouselItem",
        mangaId,
        chapterId,
        imageUrl,
        title,
        subtitle: ageText ? `${chapterLabel} · ${ageText}` : chapterLabel || undefined,
        publishDate: isNew ? new Date() : parseRelativeDate(rawTime),
      });
    }
    return items;
  }

  private async parseRecommendation($: CheerioAPI): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];
    for (const element of $("div.series-gen div.listupd div.bsx").toArray()) {
      const anchor = $("a", element).first();
      const href = anchor.attr("href") ?? "";
      const title = cleanText(anchor.attr("title") ?? $("div.tt", element).first().text());
      if (!href || !title) continue;

      const mangaId = await this.resolveMangaId(href, anchor.attr("rel"));
      if (!mangaId) continue;

      const imageUrl = this.parser.getImageSrc($("img", element)) ?? "";
      const subtitle = cleanText($("div.epxs", element).first().text()).replace(/\s+/g, " ");

      items.push({
        type: "simpleCarouselItem",
        mangaId,
        imageUrl,
        title,
        subtitle: subtitle || undefined,
      });
    }
    return items;
  }

  private async parseRankingList($: CheerioAPI, range: string): Promise<SearchResultItem[]> {
    const items: SearchResultItem[] = [];
    for (const li of $(`div.serieslist.pop.wpop-${range} li`).toArray()) {
      const anchor = $("a.series", li).first();
      const href = anchor.attr("href") ?? "";
      const title = cleanText(
        $("div.leftseries h2 a", li).first().text() || anchor.attr("title") || "",
      );
      if (!href || !title) continue;

      const imageUrl = this.parser.getImageSrc($("img", li)) ?? "";
      const subtitle = $("div.leftseries span", li)
        .first()
        .text()
        .replace(/^\s*Genres:\s*/i, "")
        .trim();

      const mangaId = await this.resolveMangaId(href, anchor.attr("rel"));
      if (!mangaId) continue;

      items.push({ mangaId, imageUrl, title, subtitle });
    }
    return items;
  }

  override async getSearchResults(
    query: SearchQuery<MangaStreamFilterMetadata>,
    metadata: MangaStreamSearchMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const rawMetadata = query.metadata;
    if (rawMetadata) {
      const range = rawMetadata.rokariRange;
      if (range && RANKING_RANGES.some((r) => r.id === range)) {
        const [, buffer] = await Application.scheduleRequest({
          url: this.domain,
          method: "GET",
        });
        const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
        return { items: await this.parseRankingList($, range) };
      }
    }

    const page = metadata?.page ?? 1;

    const includedTags: string[] = [];
    const excludedTags: string[] = [];
    for (const tags of Object.values(query.metadata ?? {})) {
      if (!tags || typeof tags !== "object" || Array.isArray(tags)) continue;
      for (const [id, state] of Object.entries(tags)) {
        if (state === "included") includedTags.push(id);
        if (state === "excluded") excludedTags.push(id);
      }
    }

    const title = (query.title ?? "").replace(/[’–][a-z]*/g, "").trim();
    const order = sortingOption?.id === "default" ? undefined : sortingOption?.id;
    const hasFilters = includedTags.length > 0 || excludedTags.length > 0 || order != null;
    let urlBuilder = new URL(this.domain);
    if (title && !hasFilters) {
      if (page > 1) {
        urlBuilder.addPathComponent("page").addPathComponent(page.toString());
      }
      urlBuilder.setQueryItem("s", title);
    } else {
      urlBuilder.addPathComponent("manga");
      if (page > 1) urlBuilder.setQueryItem("page", page.toString());
      if (title) urlBuilder.setQueryItem("s", title);
    }

    const status = getIncludedTagBySection("status", includedTags);
    const type = getIncludedTagBySection("type", includedTags);
    if (status) urlBuilder.setQueryItem("status", status);
    if (type) urlBuilder.setQueryItem("type", type);
    if (order) urlBuilder.setQueryItem("order", order);

    const genres = [
      ...getFilterTagsBySection("genres", includedTags, true),
      ...getFilterTagsBySection("genres", excludedTags, false, true),
    ];
    if (genres.length > 0) urlBuilder.setQueryItem("genre[]", genres);

    const [, buffer] = await Application.scheduleRequest({
      url: urlBuilder.toString(),
      method: "GET",
    });
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

    const hasNextPage = $("div.hpage .r, div.pagination .next, a.next.page-numbers").length > 0;
    return { items: manga, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }

  override async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  override supportsTagExclusion(): boolean {
    return true;
  }
}

// Scraped markup double-encodes entities on some titles, so decode display
// text once more at the parser boundary.
const cleanText = (value: string): string => Application.decodeHTMLEntities(value).trim();

export const RokariComics = new RokariComicsExtension();
