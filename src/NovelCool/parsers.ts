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

import { DOMAIN, TYPE_TITLES, type ListingItem, type SearchOptions, type TriState } from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const ADULT_GENRES = new Set(["adult", "erotica", "hentai", "pornographic", "smut"]);
const MATURE_GENRES = new Set([
  "ecchi",
  "gore",
  "mature",
  "netorare/ntr",
  "soft yaoi",
  "violence",
  "yaoi(bl)",
  "yuri(gl)",
]);

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

const normalizedPath = (value: string): string => {
  const path = Application.decodeHTMLEntities(value)
    .replace(/^https?:\/\/(?:www\.)?novelcool\.com/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .trim();
  return path ? (path.startsWith("/") ? path : `/${path}`) : "";
};

export const encodePathId = (value: string): string =>
  encodeURIComponent(normalizedPath(value)).replace(
    /[!'*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const resolveUrl = (value?: string | null, baseUrl = DOMAIN): string => {
  const path = Application.decodeHTMLEntities(value ?? "").trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return encodeURI(path);
  if (path.startsWith("//")) return encodeURI(`https:${path}`);
  const origin = baseUrl.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? DOMAIN;
  if (path.startsWith("/")) return encodeURI(`${origin}${path}`);
  const directory = baseUrl.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "/");
  return encodeURI(`${directory}${path}`);
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>, baseUrl = DOMAIN): string => {
  const srcset = image.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
  return resolveUrl(
    image.attr("lazy_url") ??
      image.attr("data-lazy-src") ??
      image.attr("data-src") ??
      image.attr("data-cfsrc") ??
      srcset ??
      image.attr("src"),
    baseUrl,
  );
};

export const parseDate = (value?: string | null, anchor?: number): Date | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;
  const relative = text.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relative && anchor != null) {
    const amount = Number.parseInt(relative[1], 10);
    const date = new Date(anchor);
    switch (relative[2].toLowerCase()) {
      case "minute":
        date.setMinutes(date.getMinutes() - amount);
        break;
      case "hour":
        date.setHours(date.getHours() - amount);
        break;
      case "day":
        date.setDate(date.getDate() - amount);
        break;
      case "week":
        date.setDate(date.getDate() - amount * 7);
        break;
      case "month":
        date.setMonth(date.getMonth() - amount);
        break;
      case "year":
        date.setFullYear(date.getFullYear() - amount);
        break;
    }
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
  const className = item.find("[class*='book-type-']").first().attr("class") ?? "";
  const classType = className.match(/\bbook-type-([a-z-]+)/i)?.[1];
  if (classType) {
    return classType
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }
  const textType = cleanText(item.find(".book-type, .book-list-type").first().text());
  if (textType) return textType;
  return item
    .find(".book-data-info a, .book-cate a, .book-info a")
    .toArray()
    .map((element) => cleanText(item.find(element).text()))
    .find((title) => TYPE_TITLES.has(title.toLowerCase()));
};

const parseStatus = (item: cheerio.Cheerio<AnyNode>): string | undefined => {
  const text = cleanText(item.find(".book-status, [class*='book-status']").first().text());
  const candidate =
    text ||
    item
      .find(".book-data-info a, .book-cate a, .book-info a")
      .toArray()
      .map((element) => cleanText(item.find(element).text()))
      .find((title) => /^(?:ongoing|updating|completed)$/i.test(title)) ||
    "";
  if (/complete/i.test(candidate)) return "Completed";
  if (/ongoing|updating/i.test(candidate)) return "Ongoing";
  return candidate || undefined;
};

const parseListingChapter = (item: cheerio.Cheerio<AnyNode>): ListingItem["latestChapter"] => {
  const link = item.find("a[href*='/chapter/']").first();
  const href = link.attr("href") ?? "";
  const title = cleanText(
    link.attr("title") ??
      link.find(".chapter-item-title, .chapter-item-headtitle").first().text() ??
      link.text(),
  );
  if (!href || !title) return undefined;
  return {
    chapterId: encodePathId(href),
    title,
    dateText:
      cleanText(
        link.find(".chapter-item-time").first().text() ||
          item.find(".book-data-time, time, [itemprop='dateModified']").first().text(),
      ) || undefined,
  };
};

export const parseListings = ($: cheerio.CheerioAPI): ListingItem[] => {
  const items: ListingItem[] = [];
  const seen = new Set<string>();
  for (const element of $(".book-list .book-item").toArray()) {
    const item = $(element);
    const link = item
      .find(".book-pic a[href*='/novel/'], .book-info a[href*='/novel/'], a[href*='/novel/']")
      .first();
    const href = link.attr("href") ?? "";
    const mangaId = encodePathId(href);
    const image = item.find(".book-pic img, img").first();
    const title = cleanText(
      item.find(".book-pic").first().attr("title") ??
        item.find(".book-name").first().attr("title") ??
        item.find(".book-name").first().text() ??
        image.attr("alt") ??
        link.attr("title") ??
        link.text(),
    );
    if (!mangaId || !title || seen.has(mangaId)) continue;
    seen.add(mangaId);

    const genres = item
      .find(".book-data-info a, .book-cate a, .book-info a")
      .toArray()
      .map((genre) => cleanText($(genre).text()))
      .filter(
        (genre) =>
          genre.length > 0 &&
          !TYPE_TITLES.has(genre.toLowerCase()) &&
          !/^(?:ongoing|updating|completed|summary|more details)$/i.test(genre),
      );
    const rating = Number.parseFloat(
      cleanText(item.find(".book-rate-num, [itemprop='ratingValue']").first().text()),
    );
    const latestChapter = parseListingChapter(item);
    const updatedText =
      latestChapter?.dateText ??
      cleanText(item.find(".book-data-time, time, [itemprop='dateModified']").first().text());

    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(image),
      type: parseBookType(item),
      status: parseStatus(item),
      rating: Number.isFinite(rating) ? rating : undefined,
      description:
        cleanDescription(item.find(".book-desc, .book-summary, .book-intro").first().text()) ||
        undefined,
      genres,
      updatedText: updatedText || undefined,
      latestChapter,
    });
  }
  return items;
};

export const parseFeatured = ($: cheerio.CheerioAPI): ListingItem[] => {
  const roots = $(
    ".popular-book-list .book-item, .popular .book-item, .focus-book-list .book-item, .swiper-slide .book-item, .popular-book-list .swiper-slide",
  );
  if (roots.length === 0) return [];
  return parseListings(cheerio.load(`<div class="book-list">${roots.toString()}</div>`));
};

export const parseSearchOptions = ($: cheerio.CheerioAPI): SearchOptions => {
  const genres: Tag[] = [];
  const seen = new Set<string>();
  for (const element of $(".category-list .category-id-item").toArray()) {
    const item = $(element);
    const id = cleanText(item.attr("cate_id") ?? item.attr("data-cate-id"));
    const title = cleanText(item.attr("title") ?? item.text());
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    genres.push({ id: id.replace(SAFE_ID_REGEX, "-"), title });
  }

  const years: Tag[] = [];
  const yearNodes = $("select[name='publish_year'] option, [data-year], a[href*='publish_year=']");
  for (const element of yearNodes.toArray()) {
    const item = $(element);
    const id = cleanText(
      item.attr("value") ??
        item.attr("data-year") ??
        item.attr("href")?.match(/[?&]publish_year=([^&#]+)/)?.[1],
    );
    const year = Number.parseInt(id, 10);
    if (
      !/^\d{4}$/.test(id) ||
      year < 1900 ||
      year > 2100 ||
      years.some((entry) => entry.id === id)
    ) {
      continue;
    }
    years.push({ id, title: id });
  }
  years.sort((left, right) => Number(right.id) - Number(left.id));
  return { genres, years };
};

const detailValue = ($: cheerio.CheerioAPI, label: string): string => {
  for (const element of $(".bookinfo-info p, .bookinfo-info li, .bookinfo-desc p").toArray()) {
    const row = $(element);
    if (!cleanText(row.text()).toLowerCase().startsWith(label.toLowerCase())) continue;
    const clone = row.clone();
    clone.find("label, b:first-child, strong:first-child").remove();
    return cleanText(clone.text().replace(new RegExp(`^${label}:?`, "i"), ""));
  }
  return "";
};

const detailType = ($: cheerio.CheerioAPI): string | undefined => {
  const type = parseBookType($(".bookinfo, .bookinfo-pic").first());
  if (type) return type;
  const className = $("[class*='book-type-']").first().attr("class") ?? "";
  const classType = className.match(/\bbook-type-([a-z-]+)/i)?.[1];
  return classType
    ? classType.charAt(0).toUpperCase() + classType.slice(1).replace(/-/g, " ")
    : undefined;
};

const mappedStatus = (value: string): string | undefined => {
  if (/complete/i.test(value)) return "Completed";
  if (/ongoing|updating/i.test(value)) return "Ongoing";
  return cleanText(value) || undefined;
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const primaryTitle = cleanText($("h1.bookinfo-title").first().text());
  if (!primaryTitle) throw new Error(`Unable to parse title details for ${mangaId}.`);

  const status =
    detailValue($, "Status") ||
    $(".bookinfo-category-list a")
      .toArray()
      .map((element) => cleanText($(element).text()))
      .find((value) => /^(?:ongoing|updating|completed)$/i.test(value)) ||
    "";
  const genres = $(".bookinfo-category-list a")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(
      (genre) =>
        genre.length > 0 &&
        !/^(?:ongoing|updating|completed)$/i.test(genre) &&
        !TYPE_TITLES.has(genre.toLowerCase()),
    );
  const tags = genres.map((genre) => ({
    id: genre.replace(SAFE_ID_REGEX, "-"),
    title: genre,
  }));
  const rating = Number.parseFloat(
    cleanText($("[itemprop='ratingValue'], .book-rate-num").first().text()),
  );
  const type = detailType($);
  const thumbnailUrl = imageUrlFrom($(".bookinfo-pic-img, .bookinfo-pic img").first());
  if (!thumbnailUrl) throw new Error(`Unable to parse a cover for ${mangaId}.`);

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles: [],
      thumbnailUrl,
      synopsis: cleanDescription($(".bk-summary-txt").first().text()),
      author:
        cleanText(
          $(".bookinfo-author > a").first().attr("title") ??
            $(".bookinfo-author > a").first().text(),
        ) || undefined,
      status: mappedStatus(status),
      rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
      contentRating: contentRatingForGenres(genres),
      contentType: type?.toLowerCase().includes("novel") ? "novel" : "comic",
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: resolveUrl(decodeURIComponent(mangaId)),
    },
  };
};

const chapterNumber = (value: string): number | undefined => {
  const match = value.match(/(?:chapter|ch\.?|c)[\s/_-]*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]);
  return Number.isFinite(number) ? number : undefined;
};

const chapterTitle = (value: string, mangaTitle: string): string | undefined => {
  const number = chapterNumber(value);
  let title = cleanText(value);
  if (title.toLowerCase().startsWith(mangaTitle.toLowerCase())) {
    title = cleanText(title.slice(mangaTitle.length));
  }
  if (number != null) {
    title = cleanText(
      title
        .replace(
          new RegExp(
            `^[-:\\s•]*(?:chapter|ch\\.?|c)[\\s/_-]*${number.toString().replace(".", "\\.")}`,
            "i",
          ),
          "",
        )
        .replace(/^[-:\s–—•]+/, ""),
    );
  }
  return title || undefined;
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const entries = $(".chapter-item-list a")
    .toArray()
    .flatMap((element) => {
      const link = $(element);
      const href = link.attr("href") ?? "";
      const name = cleanText(
        link.attr("title") ?? link.find(".chapter-item-title").first().text() ?? link.text(),
      );
      if (!href || !name) return [];
      return [
        {
          chapterId: encodePathId(href),
          name,
          dateText: cleanText(link.find(".chapter-item-time").first().text()),
        },
      ];
    });
  if (entries.length === 0) throw new Error(`No chapters found for ${sourceManga.mangaId}.`);

  const seen = new Set<string>();
  return entries.flatMap((entry, index) => {
    if (seen.has(entry.chapterId)) return [];
    seen.add(entry.chapterId);
    const number =
      chapterNumber(entry.name) ?? chapterNumber(decodeURIComponent(entry.chapterId)) ?? 0;
    return [
      {
        chapterId: entry.chapterId,
        sourceManga,
        langCode: "en",
        chapNum: number,
        title: chapterTitle(entry.name, sourceManga.mangaInfo.primaryTitle),
        version: sourceManga.mangaInfo.contentType === "novel" ? "Novel" : undefined,
        volume: 0,
        sortingIndex: entries.length - index,
        publishDate: parseDate(entry.dateText),
      },
    ];
  });
};

const escapeXhtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const imageManifest = ($: cheerio.CheerioAPI, baseUrl: string): string[] => {
  const script = $("script")
    .toArray()
    .map((element) => $(element).html() ?? "")
    .find((value) => value.includes("all_imgs_url"));
  if (!script) return [];
  const arrayContent = script.match(/all_imgs_url\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const pages: string[] = [];
  for (const match of arrayContent.matchAll(/["']([^"']+)["']/g)) {
    const page = resolveUrl(match[1].replace(/\\\//g, "/"), baseUrl);
    if (/^https?:\/\/\S+$/i.test(page) && !pages.includes(page)) pages.push(page);
  }
  return pages;
};

export const parseReaderImages = ($: cheerio.CheerioAPI, baseUrl: string): string[] => {
  const manifest = imageManifest($, baseUrl);
  if (manifest.length > 0) return manifest;

  const pages: string[] = [];
  for (const element of $(
    ".mangaread-manga-pic, .pic_box source.manga_pic, .pic_box img, .reading-content img",
  ).toArray()) {
    const page = imageUrlFrom($(element), baseUrl);
    if (/^https?:\/\/\S+$/i.test(page) && !pages.includes(page)) pages.push(page);
  }
  return pages;
};

export const parseReaderPageUrls = ($: cheerio.CheerioAPI, baseUrl: string): string[] => {
  const urls: string[] = [];
  for (const element of $(
    ".mangaread-pagenav > .sl-page option, select.sl-page option",
  ).toArray()) {
    const url = resolveUrl($(element).attr("value"), baseUrl);
    if (/^https?:\/\/\S+$/i.test(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
};

export const parseChapterDetails = (
  $: cheerio.CheerioAPI,
  baseUrl: string,
  chapter: Chapter,
): ChapterDetails | undefined => {
  const pages = parseReaderImages($, baseUrl);
  if (pages.length > 0) {
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  const marker = $(".chapter-start-mark").first();
  if (marker.length === 0) return undefined;
  const container = marker.parent().clone();
  container
    .find(
      ".chapter-title, .chapter-start-mark, .chapter-end-mark, [model_target_name='report'], script, style",
    )
    .remove();
  container.find("img").each((_, image) => {
    const node = $(image);
    const src = imageUrlFrom(node, baseUrl);
    if (src) node.attr("src", src);
  });
  const content = container.html()?.trim();
  if (!content) throw new Error(`No readable content found for ${chapter.chapterId}.`);
  const heading = chapter.title
    ? `<h2>${escapeXhtml(chapter.title)}</h2>`
    : `<h2>Chapter ${chapter.chapNum}</h2>`;
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${heading}${content}</body></html>`,
  };
};

export const hasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $("div.page-nav a div.next, .page-nav a.next, .pagination a.next").length > 0;

export const pickTriState = (
  value: TriState | undefined,
  state: "included" | "excluded",
): string[] =>
  Object.entries(value ?? {})
    .filter(([, current]) => current === state)
    .map(([id]) => id);

export const typeTags = (options: SearchOptions): Tag[] =>
  options.genres.filter((genre) => TYPE_TITLES.has(genre.title.toLowerCase()));

const chapterLabel = (title: string): string => {
  const number = chapterNumber(title);
  return number == null ? cleanText(title) : `Ch. ${number}`;
};

export const toFeaturedItem = (item: ListingItem): FeaturedCarouselItem => {
  const infoItems: NonNullable<FeaturedCarouselItem["infoItems"]>[number][] = [];
  if (item.rating != null) {
    infoItems.push({ symbol: "star.fill", text: item.rating.toFixed(1) });
  }
  if (item.type) infoItems.push({ symbol: "books.vertical.fill", text: item.type });
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: item.status,
    summary: item.description,
    infoItems: infoItems.length
      ? (infoItems.slice(0, 2) as FeaturedCarouselItem["infoItems"])
      : undefined,
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toSimpleItem = (item: ListingItem): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle: item.type,
  contentRating: contentRatingForGenres(item.genres),
});

export const toLatestItem = (
  item: ListingItem,
  dateAnchor: number,
): ChapterUpdatesCarouselItem | DiscoverSectionItem => {
  if (!item.latestChapter) return toSimpleItem(item);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: item.latestChapter.chapterId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle: [item.type, chapterLabel(item.latestChapter.title)]
      .filter((value): value is string => Boolean(value))
      .join(" • "),
    publishDate: parseDate(item.latestChapter.dateText ?? item.updatedText, dateAnchor),
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toSearchResultItem = (item: ListingItem): SearchResultItem => ({
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle:
    [
      item.type,
      item.status,
      item.latestChapter ? chapterLabel(item.latestChapter.title) : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(item.genres),
});
