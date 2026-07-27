/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
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
const TYPE_TITLES = new Set(["comic", "comics", "manga", "manhua", "manhwa", "novel", "web novel", "webtoon"]);

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

const normalizedPath = (href: string): string => {
  const path = Application.decodeHTMLEntities(href)
    .replace(/^https?:\/\/(?:www\.)?novelcool\.com/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .trim();
  return path ? (path.startsWith("/") ? path : `/${path}`) : "";
};

export const encodePathId = (href: string): string =>
  encodeURIComponent(normalizedPath(href)).replace(
    /[!'*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const toAbsoluteUrl = (value?: string | null): string => {
  const url = Application.decodeHTMLEntities(value ?? "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return encodeURI(`https:${url}`);
  if (/^https?:\/\//i.test(url)) return encodeURI(url);
  return encodeURI(`${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`);
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>): string => {
  const srcset = image.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
  return toAbsoluteUrl(
    image.attr("lazy_url") ??
      image.attr("data-src") ??
      image.attr("cover_url") ??
      srcset ??
      image.attr("src"),
  );
};

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

const titleFrom = (item: cheerio.Cheerio<AnyNode>, link: cheerio.Cheerio<AnyNode>): string => {
  const name = item.find(".book-name[itemprop='name'], .book-name").first();
  const clone = name.clone();
  clone.find(".book-rate, .book-rate-num, .book-data-info, .book-data-time, span, em").remove();
  return cleanText(name.attr("title") ?? clone.text() ?? name.text() ?? link.attr("title") ?? link.text());
};

const parseBookType = (item: cheerio.Cheerio<AnyNode>): string | undefined => {
  const badge = cleanText(
    item.find(".book-type, [class*=book-type-], .book-list-type, .book-pic > span").first().text(),
  );
  if (badge) return badge;
  const category = item
    .find(".book-data-info a, .book-cate a, .book-info a, a[href*='category']")
    .toArray()
    .map((element) => cleanText(item.find(element).text()))
    .find((title) => TYPE_TITLES.has(title.toLowerCase()));
  if (category) return category;
  const className = item.attr("class") ?? "";
  const match = className.match(/book-type-([a-z-]+)/i);
  return match?.[1]
    ? match[1]
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : undefined;
};

const parseListingChapter = (item: cheerio.Cheerio<AnyNode>): ListingItem["latestChapter"] => {
  const link = item.find("a[href*='/chapter/'], a[href*='/Chapter']").first();
  const href = link.attr("href") ?? "";
  const title = cleanText(link.find(".chapter-item-title, .chapter-item-headtitle").first().text() || link.attr("title") || link.text());
  if (!href || !title) return undefined;
  return {
    chapterId: encodePathId(href),
    title,
    dateText: cleanText(item.find(".book-data-time, .chapter-item-time, time, [itemprop='dateModified']").first().text()),
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
    const title = titleFrom(item, link);
    if (!mangaId || !title || seen.has(mangaId)) continue;
    seen.add(mangaId);
    const rating = Number.parseFloat(cleanText(item.find(".book-rate-num, [itemprop='ratingValue']").first().text()));
    const latestChapter = parseListingChapter(item);
    const updatedText =
      cleanText(item.find(".book-data-time, [itemprop='dateModified'], time").first().text()) ||
      latestChapter?.dateText;
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
      latestChapter,
    });
  }
  return items;
};

export const parseFeatured = ($: cheerio.CheerioAPI): ListingItem[] => {
  const roots = $(".popular-book-list .book-item, .popular .book-item, .swiper-slide .book-item, .focus-book-list .book-item");
  if (roots.length === 0) return parseListings($).slice(0, 12);
  const scoped = cheerio.load(`<div class="book-list">${roots.toString()}</div>`);
  return parseListings(scoped);
};

export const parseSearchOptions = ($: cheerio.CheerioAPI): SearchOptions => {
  const genres: Tag[] = [];
  const years: Tag[] = [];
  const genreSeen = new Set<string>();

  for (const element of $(".category-list .category-id-item, [cate_id], [data-cate-id]").toArray()) {
    const item = $(element);
    const id = cleanText(item.attr("cate_id") ?? item.attr("data-cate-id"));
    const title = cleanText(item.attr("title") ?? item.text());
    if (!id || !title || genreSeen.has(id)) continue;
    genreSeen.add(id);
    genres.push({ id, title });
  }
  if (genres.length === 0) {
    for (const element of $("a[href*='category_id='], a[href*='/category/']").toArray()) {
      const link = $(element);
      const href = link.attr("href") ?? "";
      const id = href.match(/[?&]category_id=([^&#]+)/)?.[1] ?? href.split("/").filter(Boolean).pop()?.replace(/\.html$/i, "") ?? "";
      const title = cleanText(link.text());
      if (!id || !title || genreSeen.has(id)) continue;
      genreSeen.add(id);
      genres.push({ id, title });
    }
  }

  for (const element of $("[data-year], a[href*='year='], a[href*='publish_year=']").toArray()) {
    const item = $(element);
    const id = cleanText(
      item.attr("data-year") ??
        item.attr("href")?.match(/[?&](?:publish_)?year=([^&#]+)/)?.[1],
    );
    const title = cleanText(item.text()) || id;
    if (!id || !title || id === "0" || years.some((year) => year.id === id)) continue;
    years.push({ id, title });
  }

  return { genres, years };
};

const mapStatus = (value: string): string | undefined => {
  const status = cleanText(value).toLowerCase();
  if (!status) return undefined;
  if (status.includes("complete")) return "Completed";
  if (status.includes("ongoing") || status.includes("updating")) return "Ongoing";
  return cleanText(value);
};

const detailValue = ($: cheerio.CheerioAPI, label: string): string => {
  const normalized = label.toLowerCase();
  for (const element of $(".bookinfo-info p, .bookinfo-info li, .bookinfo-desc p").toArray()) {
    const row = $(element);
    const rowText = cleanText(row.text());
    if (!rowText.toLowerCase().startsWith(normalized)) continue;
    const clone = row.clone();
    clone.find("label, span:first-child, b:first-child, strong:first-child").remove();
    return cleanText(clone.text().replace(new RegExp(`^${label}:?`, "i"), ""));
  }
  return "";
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
      return { id: href.split("/").filter(Boolean).pop()?.replace(/\.html$/i, "") ?? cleanText(link.text()), title: cleanText(link.text()) };
    })
    .toArray()
    .filter((tag) => tag.id && tag.title);
  const rawRating = Number.parseFloat(cleanText($("[itemprop='ratingValue'], .book-rate-num").first().text()));
  const status = detailValue($, "Status") || cleanText($(".bookinfo-status, .bookinfo-state").first().text());

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
      shareUrl: toAbsoluteUrl(decodeURIComponent(mangaId)),
    },
  };
};

const chapterNumber = (value: string): number | undefined => {
  const match = value.match(/(?:chapter|ch\.?|c)[\s/_-]*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]);
  return Number.isFinite(number) ? number : undefined;
};

const formatChapterTitle = (value: string): string => {
  const title = cleanText(value);
  const number = chapterNumber(title);
  if (number == null) return title;
  return cleanText(
    title
      .replace(new RegExp(`\\b(?:chapter|ch\\.?|c)[\\s/_-]*${number.toString().replace(".", "\\.")}`, "gi"), "")
      .replace(/^[-:\s•]+|[-:\s•]+$/g, ""),
  );
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
    const title = formatChapterTitle(entry.title);
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
    const arrayContent = script.match(/all_imgs_url\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    for (const match of arrayContent.matchAll(/["']([^"']+)["']/g)) {
      const page = toAbsoluteUrl(match[1].replace(/\\\//g, "/"));
      if (page && !pages.includes(page)) pages.push(page);
    }
  }
  if (pages.length === 0) {
    for (const element of $(".mangaread-manga-pic, .pic_box img, source.manga_pic, .reading-content img").toArray()) {
      const imageUrl = imageUrlFrom($(element));
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
  $("div.page-nav a div.next, .page-nav a.next, .pagination a.next, .pagination a")
    .toArray()
    .some((element) => /^(next|›|»)$/i.test(cleanText($(element).text())) || $(element).find(".next").length > 0);

export const pickTriState = (value: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.entries(value ?? {})
    .filter(([, current]) => current === state)
    .map(([id]) => id);

export const typeTags = (options: SearchOptions): Tag[] =>
  options.genres.filter((genre) => TYPE_TITLES.has(genre.title.toLowerCase()));

export const toFeaturedItem = (item: ListingItem): FeaturedCarouselItem => {
  const infoItems: NonNullable<FeaturedCarouselItem["infoItems"]>[number][] = [];
  if (item.rating != null) infoItems.push({ symbol: "star.fill", text: `${item.rating.toFixed(1)} rating` });
  if (item.type) infoItems.push({ symbol: "books.vertical.fill", text: item.type });
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: [item.status, item.type].filter(Boolean).join(" • ") || undefined,
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

export const toLatestItem = (item: ListingItem): ChapterUpdatesCarouselItem | DiscoverSectionItem => {
  if (!item.latestChapter) return toSimpleItem(item);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: item.latestChapter.chapterId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle: [item.type, item.latestChapter.title].filter(Boolean).join(" • "),
    publishDate: parseDate(item.latestChapter.dateText) ?? item.updatedDate,
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
