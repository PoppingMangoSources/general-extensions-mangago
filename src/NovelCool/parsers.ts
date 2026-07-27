/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  URL,
  type Chapter,
  type ChapterDetails,
  type ChapterUpdatesCarouselItem,
  type DiscoverSectionItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  type ChapterEntry,
  type ListingItem,
  type SearchOptions,
  type TriState,
} from "./models";

const ADULT_GENRES = new Set(["adult", "hentai", "smut"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "yaoi", "yuri"]);

const cleanText = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const cleanDescription = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normalizedPath = (href: string): string =>
  Application.decodeHTMLEntities(href)
    .replace(/^https?:\/\/(?:www\.)?novelcool\.com/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+/, "/")
    .trim();

export const encodePathId = (href: string): string => encodeURIComponent(normalizedPath(href));

const toAbsoluteUrl = (value?: string | null): string => {
  const url = (value ?? "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(DOMAIN).setPath(url).toString();
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>): string =>
  toAbsoluteUrl(
    image.attr("lazy_url") ??
      image.attr("data-src") ??
      image.attr("cover_url") ??
      image.attr("src"),
  );

const parseDate = (value?: string | null): Date | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;
  const relative = text.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const date = new Date();
    const unit = relative[2].toLowerCase();
    if (unit === "minute") date.setMinutes(date.getMinutes() - amount);
    else if (unit === "hour") date.setHours(date.getHours() - amount);
    else if (unit === "day") date.setDate(date.getDate() - amount);
    else if (unit === "week") date.setDate(date.getDate() - amount * 7);
    else if (unit === "month") date.setMonth(date.getMonth() - amount);
    else date.setFullYear(date.getFullYear() - amount);
    return date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const parseBookType = (item: cheerio.Cheerio<AnyNode>): string | undefined => {
  const badge = cleanText(
    item.find(".book-type, [class*=book-type-], .book-list-type, .book-pic > span").first().text(),
  );
  if (badge) return badge;
  const className = item.attr("class") ?? "";
  const match = className.match(/book-type-([a-z-]+)/i);
  return match?.[1]
    ? match[1]
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : undefined;
};

const parseListingChapter = (
  item: cheerio.Cheerio<AnyNode>,
): ListingItem["latestChapter"] => {
  const link = item.find("a[href*='/chapter/'], a[href*='/Chapter']").first();
  const href = link.attr("href") ?? "";
  const title = cleanText(link.attr("title") ?? link.text());
  if (!href || !title) return undefined;
  return {
    chapterId: encodePathId(href),
    title,
    dateText: cleanText(item.find(".book-data-time, .chapter-item-time, time").first().text()),
  };
};

export const parseListings = ($: cheerio.CheerioAPI): ListingItem[] => {
  const items: ListingItem[] = [];
  const seen = new Set<string>();
  for (const element of $(".book-list .book-item, .book-item").toArray()) {
    const item = $(element);
    const link = item.find("a[href*='/novel/']").first();
    const href = link.attr("href") ?? "";
    const mangaId = encodePathId(href);
    const title = cleanText(
      item.find(".book-name[itemprop='name'], .book-name, .book-pic").first().attr("title") ??
        item.find(".book-name[itemprop='name'], .book-name").first().text() ??
        link.attr("title"),
    );
    if (!mangaId || !title || seen.has(mangaId)) continue;
    seen.add(mangaId);
    const rating = Number.parseFloat(
      cleanText(item.find(".book-rate-num, [itemprop='ratingValue']").first().text()),
    );
    const updatedText = cleanText(
      item.find(".book-data-time, [itemprop='dateModified'], time").first().text(),
    );
    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(item.find("img").first()),
      type: parseBookType(item),
      status: cleanText(item.find(".book-status, .status").first().text()) || undefined,
      rating: Number.isFinite(rating) ? rating : undefined,
      description: cleanDescription(item.find(".book-desc, .book-summary, .book-intro").first().text()) || undefined,
      updatedText: updatedText || undefined,
      updatedDate: parseDate(updatedText),
      latestChapter: parseListingChapter(item),
    });
  }
  return items;
};

export const parseFeatured = ($: cheerio.CheerioAPI): ListingItem[] => {
  const roots = $(".popular-book-list .book-item, .popular .book-item, .swiper-slide .book-item");
  if (roots.length === 0) return parseListings($).slice(0, 12);
  const scoped = cheerio.load(`<div class="book-list">${roots.toString()}</div>`);
  return parseListings(scoped);
};

export const parseSearchOptions = ($: cheerio.CheerioAPI): SearchOptions => {
  const genres: Tag[] = [];
  const years: Tag[] = [];
  const alphabets: Tag[] = [];
  const genreSeen = new Set<string>();

  for (const element of $(".category-list .category-id-item").toArray()) {
    const item = $(element);
    const id = cleanText(item.attr("cate_id"));
    const title = cleanText(item.attr("title") ?? item.text());
    if (!id || !title || genreSeen.has(id)) continue;
    genreSeen.add(id);
    genres.push({ id, title });
  }
  if (genres.length === 0) {
    for (const element of $("a[href*='category_id=']").toArray()) {
      const link = $(element);
      const id = link.attr("href")?.match(/[?&]category_id=([^&#]+)/)?.[1] ?? "";
      const title = cleanText(link.text());
      if (!id || !title || genreSeen.has(id)) continue;
      genreSeen.add(id);
      genres.push({ id, title });
    }
  }

  for (const element of $("[data-year], a[href*='year=']").toArray()) {
    const item = $(element);
    const id = cleanText(item.attr("data-year") ?? item.attr("href")?.match(/[?&]year=([^&#]+)/)?.[1]);
    const title = cleanText(item.text());
    if (!id || !title || years.some((year) => year.id === id)) continue;
    years.push({ id, title });
  }

  for (const element of $("[data-alphabet], a[href*='alphabet=']").toArray()) {
    const item = $(element);
    const id = cleanText(
      item.attr("data-alphabet") ?? item.attr("href")?.match(/[?&]alphabet=([^&#]+)/)?.[1],
    );
    const title = cleanText(item.text());
    if (!id || !title || alphabets.some((alphabet) => alphabet.id === id)) continue;
    alphabets.push({ id, title });
  }

  return { genres, years, alphabets };
};

const mapStatus = (value: string): string | undefined => {
  const status = cleanText(value).toLowerCase();
  if (!status) return undefined;
  if (status.includes("complete")) return "Completed";
  if (status.includes("ongoing") || status.includes("updating")) return "Ongoing";
  return cleanText(value);
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const primaryTitle = cleanText($("h1.bookinfo-title, .bookinfo-info h1").first().text());
  if (!primaryTitle) throw new Error(`Unable to parse manga details for ${mangaId}.`);
  const genres = $(".bookinfo-category-list a")
    .map((_, element) => cleanText($(element).text()))
    .toArray()
    .filter(Boolean);
  const tags = $(".bookinfo-category-list a")
    .map((_, element) => {
      const link = $(element);
      const href = link.attr("href") ?? "";
      return { id: href.split("/").filter(Boolean).pop() ?? cleanText(link.text()), title: cleanText(link.text()) };
    })
    .toArray()
    .filter((tag) => tag.id && tag.title);
  const rawRating = Number.parseFloat(
    cleanText($("[itemprop='ratingValue'], .book-rate-num").first().text()),
  );
  const status = cleanText(
    $(".bookinfo-category-list a").first().text() || $(".bookinfo-status").first().text(),
  );

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles: [],
      thumbnailUrl: imageUrlFrom($(".bookinfo-pic-img, .bookinfo-pic img").first()),
      synopsis: cleanDescription($(".bk-summary-txt").first().text()),
      author: cleanText($(".bookinfo-author > a, .bookinfo-author a").first().attr("title") ?? $(".bookinfo-author > a, .bookinfo-author a").first().text()) || undefined,
      status: mapStatus(status),
      rating: Number.isFinite(rawRating) ? Math.min(1, Math.max(0, rawRating / 5)) : undefined,
      contentRating: contentRatingForGenres(genres),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: new URL(DOMAIN).setPath(decodeURIComponent(mangaId)).toString(),
    },
  };
};

const chapterNumber = (value: string): number | undefined => {
  const match = value.match(/(?:chapter|ch\.?)[\s/_-]*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]);
  return Number.isFinite(number) ? number : undefined;
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const entries: ChapterEntry[] = [];
  const seen = new Set<string>();
  for (const element of $(".chapter-item-list a, .chp-item a").toArray()) {
    const link = $(element);
    const href = link.attr("href") ?? "";
    const chapterId = encodePathId(href);
    const title = cleanText(
      link.attr("title") ?? link.find(".chapter-item-title, .chapter-item-headtitle").first().text() ?? link.text(),
    );
    if (!chapterId || !title || seen.has(chapterId)) continue;
    seen.add(chapterId);
    entries.push({
      chapterId,
      title,
      dateText: cleanText(link.find(".chapter-item-time").first().text()),
    });
  }
  if (entries.length === 0) throw new Error(`No chapters found for ${sourceManga.mangaId}.`);
  return entries.map((entry, index) => {
    const chapNum = chapterNumber(entry.title) ?? chapterNumber(decodeURIComponent(entry.chapterId)) ?? 0;
    const prefix = entry.title.match(/(?:chapter|ch\.?)[\s/_-]*\d+(?:\.\d+)?/i)?.[0];
    const title = prefix ? cleanText(entry.title.replace(prefix, "").replace(/^[-:\s]+/, "")) : entry.title;
    return {
      chapterId: entry.chapterId,
      sourceManga,
      langCode: "en",
      chapNum,
      title: title || undefined,
      volume: 0,
      sortingIndex: entries.length - index,
      publishDate: parseDate(entry.dateText),
    };
  });
};

const extractImages = ($: cheerio.CheerioAPI): string[] => {
  const pages: string[] = [];
  const script = $("script")
    .toArray()
    .map((element) => $(element).html() ?? "")
    .find((value) => value.includes("all_imgs_url"));
  if (script) {
    const arrayContent = script.split("all_imgs_url:")[1]?.split("]")[0] ?? "";
    for (const match of arrayContent.matchAll(/["'](https?:\\?\/\\?\/[^"']+)["']/g)) {
      pages.push(match[1].replace(/\\\//g, "/"));
    }
  }
  if (pages.length === 0) {
    for (const element of $(".mangaread-manga-pic, .pic_box img, source.manga_pic").toArray()) {
      const imageUrl = toAbsoluteUrl($(element).attr("src") ?? $(element).attr("data-src"));
      if (imageUrl && !pages.includes(imageUrl)) pages.push(imageUrl);
    }
  }
  return pages;
};

export const parseChapterDetails = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const pages = extractImages($);
  if (pages.length > 0) {
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  const textContainer = $(".chapter-start-mark").first().parent();
  if (textContainer.length === 0) throw new Error(`No readable content found for ${chapter.chapterId}.`);
  textContainer.find(".chapter-title, .chapter-start-mark, .chapter-end-mark, [model_target_name='report'], script, style").remove();
  const html = textContainer.html()?.trim();
  if (!html) throw new Error(`No readable content found for ${chapter.chapterId}.`);
  return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, html };
};

export const hasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $("div.page-nav a div.next, .page-nav a.next, .pagination a.next").length > 0;

export const pickTriState = (value: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.entries(value ?? {})
    .filter(([, current]) => current === state)
    .map(([id]) => id);

export const toFeaturedItem = (item: ListingItem): FeaturedCarouselItem => {
  const infoItems: NonNullable<FeaturedCarouselItem["infoItems"]>[number][] = [];
  if (item.type || item.status) {
    infoItems.push({ symbol: "books.vertical.fill", text: [item.type, item.status].filter(Boolean).join(" • ") });
  }
  if (item.rating != null) {
    infoItems.push({ symbol: "star.fill", text: `${item.rating.toFixed(1)} rating` });
  }
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: [item.type, item.status].filter(Boolean).join(" • ") || undefined,
    summary: item.description,
    infoItems: infoItems.length ? (infoItems.slice(0, 2) as FeaturedCarouselItem["infoItems"]) : undefined,
    contentRating: ContentRating.EVERYONE,
  };
};

export const toSimpleItem = (item: ListingItem): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle: [item.type, item.updatedText].filter(Boolean).join(" • "),
  contentRating: ContentRating.EVERYONE,
});

export const toLatestItem = (
  item: ListingItem,
): ChapterUpdatesCarouselItem | DiscoverSectionItem => {
  if (!item.latestChapter) return toSimpleItem(item);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: item.latestChapter.chapterId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle: [item.type, item.latestChapter.title].filter(Boolean).join(" • "),
    publishDate: item.updatedDate,
    contentRating: ContentRating.EVERYONE,
  };
};

export const toSearchResultItem = (item: ListingItem): SearchResultItem => ({
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle: [item.type, item.status, item.updatedText].filter(Boolean).join(" • "),
  contentRating: ContentRating.EVERYONE,
});
