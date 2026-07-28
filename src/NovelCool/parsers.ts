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
  TYPE_TITLES,
  type ListingItem,
  type NovelCoolBook,
  type NovelCoolChapter,
  type NovelCoolChapterInfo,
  type SearchOptions,
  type TriState,
} from "./models";

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

const encodeBookPathId = (value: string): string => {
  const path = Application.decodeHTMLEntities(value)
    .replace(/^https?:\/\/(?:www\.)?novelcool\.com/i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .trim();
  if (!path) return "";
  return encodeURIComponent(path.startsWith("/") ? path : `/${path}`).replace(
    /[!'*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
};

const resolveUrl = (value?: string | null): string => {
  const path = Application.decodeHTMLEntities(value ?? "").trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return encodeURI(path);
  if (path.startsWith("//")) return encodeURI(`https:${path}`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return "";
  return encodeURI(`${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`);
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>): string => {
  const srcset = image.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
  return resolveUrl(
    image.attr("lazy_url") ??
      image.attr("data-lazy-src") ??
      image.attr("data-src") ??
      image.attr("data-cfsrc") ??
      srcset ??
      image.attr("src"),
  );
};

const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const parseDate = (value?: string | null, anchor?: number): Date | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;
  const unixSeconds = Number(text);
  if (/^\d{9,10}$/.test(text) && Number.isFinite(unixSeconds)) {
    return new Date(unixSeconds * 1000);
  }
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

const mappedStatus = (value?: string | null): string | undefined => {
  const status = cleanText(value).toLowerCase();
  if (status === "yes" || status.includes("complete")) return "Completed";
  if (status === "no" || status.includes("ongoing") || status.includes("updating")) {
    return "Ongoing";
  }
  return status ? cleanText(value) : undefined;
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
  return cleanText(item.find(".book-type, .book-list-type").first().text()) || undefined;
};

const chapterIdFromUrl = (value: string): string =>
  value.match(/\/(\d+)(?:\.html)?\/?(?:[?#].*)?$/)?.[1] ?? "";

const bookIdFromItem = (item: cheerio.Cheerio<AnyNode>, href: string): string =>
  cleanText(item.find("[book_id]").first().attr("book_id")) ||
  href.match(/\/id-(\d+)\.html/i)?.[1] ||
  encodeBookPathId(href);

const parseListingChapter = (item: cheerio.Cheerio<AnyNode>): ListingItem["latestChapter"] => {
  const link = item.find("a[href*='/chapter/']").first();
  const chapterId = chapterIdFromUrl(link.attr("href") ?? "");
  const title = cleanText(
    link.attr("title") ??
      link.find(".chapter-item-title, .chapter-item-headtitle").first().text() ??
      link.text(),
  );
  if (!chapterId || !title) return undefined;
  return {
    chapterId,
    title,
    dateText:
      cleanText(
        link.find(".chapter-item-time").first().text() ||
          item.find(".book-data-time, time, [itemprop='dateModified']").first().text(),
      ) || undefined,
  };
};

export const parseListings = ($: cheerio.CheerioAPI): ListingItem[] => {
  const listings: ListingItem[] = [];
  const seen = new Set<string>();
  for (const element of $(".book-list .book-item").toArray()) {
    const item = $(element);
    const link = item.find("a[href*='/novel/']").first();
    const href = link.attr("href") ?? "";
    const mangaId = bookIdFromItem(item, href).replace(SAFE_ID_REGEX, "-");
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

    listings.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(image),
      type: parseBookType(item),
      status:
        mappedStatus(item.find(".book-status, [class*='book-status']").first().text()) ?? undefined,
      rating: Number.isFinite(rating) ? rating : undefined,
      description:
        cleanDescription(item.find(".book-desc, .book-summary, .book-intro").first().text()) ||
        undefined,
      genres,
      updatedText: updatedText || undefined,
      latestChapter,
    });
  }
  return listings;
};

export const parseFeatured = ($: cheerio.CheerioAPI): ListingItem[] => {
  const items = $(".index-carousel .carousel-item .book-item");
  if (items.length === 0) return [];
  return parseListings(cheerio.load(`<div class="book-list">${items.toString()}</div>`));
};

export const parseApiListings = (books: NovelCoolBook[]): ListingItem[] =>
  books.map((book) => ({
    mangaId: (book.book_id || book.id).replace(SAFE_ID_REGEX, "-"),
    title: cleanText(book.name),
    imageUrl: resolveUrl(book.cover),
    type: book.is_novel === "1" ? "Novel" : "Manga",
    status: mappedStatus(book.completed),
    rating: Number.isFinite(Number(book.rate_star)) ? Number(book.rate_star) : undefined,
    description: cleanDescription(book.intro) || undefined,
    genres: book.category_list ?? [],
    updatedText: book.modify_time,
    latestChapter:
      book.last_chapter_id && book.last_chapter_title
        ? {
            chapterId: book.last_chapter_id,
            title: cleanText(book.last_chapter_title),
            dateText: book.modify_time,
          }
        : undefined,
  }));

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
  for (const element of $(
    ".category-year-item[cate_year], select[name='publish_year'] option, [data-year], a[href*='publish_year=']",
  ).toArray()) {
    const item = $(element);
    const id = cleanText(
      item.attr("cate_year") ??
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

export const parseBookId = ($: cheerio.CheerioAPI): string => {
  const script = $("script")
    .toArray()
    .map((element) => $(element).html() ?? "")
    .find((value) => /\bBOOK_ID\s*=/.test(value));
  const bookId =
    script?.match(/\bBOOK_ID\s*=\s*["']?(\d+)/)?.[1] ??
    $("input[name='book_id'], [book_id]").first().attr("value") ??
    $("input[name='book_id'], [book_id]").first().attr("book_id") ??
    "";
  if (!bookId) throw new Error("NovelCool did not expose a book id for this URL.");
  return bookId;
};

export const bookIdToUrl = (mangaId: string): string | undefined => {
  try {
    const path = decodeURIComponent(mangaId);
    return /^\/novel\/[^?#]+\.html$/i.test(path) ? resolveUrl(path) : undefined;
  } catch {
    return undefined;
  }
};

const cleanCreator = (value?: string | null): string | undefined => {
  const creator = cleanText(value).replace(/^(?:author|artist):\s*/i, "");
  return creator && !/^(?:n\/a|unknown)$/i.test(creator) ? creator : undefined;
};

export const parseMangaDetails = (book: NovelCoolBook, mangaId: string): SourceManga => {
  const primaryTitle = cleanText(book.name);
  const thumbnailUrl = resolveUrl(book.cover);
  if (!primaryTitle) throw new Error(`Unable to parse title details for ${mangaId}.`);
  if (!thumbnailUrl) throw new Error(`Unable to parse a cover for ${mangaId}.`);

  const genres = book.category_list ?? [];
  const tags = genres.map((genre) => ({
    id: genre.replace(SAFE_ID_REGEX, "-"),
    title: genre,
  }));
  const rating = Number(book.rate_star);
  const alternative = cleanText(book.alternative);
  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles:
        alternative && alternative.toLowerCase() !== primaryTitle.toLowerCase()
          ? [alternative]
          : [],
      thumbnailUrl,
      synopsis: cleanDescription(book.intro),
      author: cleanCreator(book.author),
      artist: cleanCreator(book.artist),
      status: mappedStatus(book.completed),
      rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
      contentRating: contentRatingForGenres(genres),
      contentType: book.is_novel === "1" ? "novel" : "comic",
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl:
        resolveUrl(book.url) ||
        (book.visit_path
          ? `${DOMAIN}/novel/${encodeURIComponent(book.visit_path)}.html`
          : undefined),
    },
  };
};

const chapterNumber = (value: string): number | undefined => {
  const match = value.match(
    /(?:chapter|chap(?:ter)?|ch\.?|part|episode|ep\.?|cap[ií]tulo)\s*(\d+(?:\.\d+)?)/i,
  );
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]);
  return Number.isFinite(number) ? number : undefined;
};

const chapterTitle = (value: string): string | undefined => {
  const title = cleanText(value).replace(
    /^(?:chapter|chap(?:ter)?|ch\.?|part|episode|ep\.?|cap[ií]tulo)\s*\d+(?:\.\d+)?\s*[-:–—]?\s*/i,
    "",
  );
  return title || undefined;
};

const chapterIsLocked = (value?: boolean | string | number): boolean =>
  value === true || value === 1 || value === "1" || value === "true";

export const parseChapters = (
  chapters: NovelCoolChapter[],
  sourceManga: SourceManga,
): Chapter[] => {
  const readable = chapters.filter((chapter) => !chapterIsLocked(chapter.is_locked)).reverse();
  if (readable.length === 0)
    throw new Error(`No readable chapters found for ${sourceManga.mangaId}.`);

  return readable.map((chapter, index) => {
    const order = Number.parseFloat(chapter.order_id ?? "");
    const chapNum =
      (Number.isFinite(order) && order > 0 ? order : undefined) ??
      chapterNumber(chapter.title) ??
      index + 1;
    return {
      chapterId: chapter.id.replace(SAFE_ID_REGEX, "-"),
      sourceManga,
      langCode: "en",
      chapNum,
      title: chapterTitle(chapter.title),
      version: sourceManga.mangaInfo.contentType === "novel" ? "Novel" : undefined,
      volume: 0,
      sortingIndex: index,
      publishDate: parseDate(chapter.last_modify ?? chapter.tf_time),
    };
  });
};

const escapeXhtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const contentBody = (value: string): string => {
  const decoded = Application.decodeHTMLEntities(value).replace(/\r/g, "").trim();
  if (/<[a-z][\s\S]*>/i.test(decoded)) return decoded;
  return decoded
    .replace(/^\*\*([^*]+)\*\*\s*/, "")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeXhtml(paragraph.replace(/\n/g, " ").trim())}</p>`)
    .join("");
};

export const parseChapterDetails = (
  info: NovelCoolChapterInfo,
  chapter: Chapter,
): ChapterDetails => {
  if (chapterIsLocked(info.is_locked)) {
    throw new Error("This chapter is locked and cannot be read.");
  }

  const pages = [...(info.pic_list ?? [])]
    .sort((left, right) => (left.order_id ?? 0) - (right.order_id ?? 0))
    .map((page) => resolveUrl(page.pic_path))
    .filter((page) => /^https?:\/\/\S+$/i.test(page));
  if (pages.length > 0) {
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  const content = info.content?.trim() ?? "";
  if (!content) throw new Error(`No readable content found for ${chapter.chapterId}.`);
  const heading = cleanText(info.title) || chapter.title || `Chapter ${chapter.chapNum}`;
  const $ = cheerio.load(`<h2>${escapeXhtml(heading)}</h2>${contentBody(content)}`, null, false);
  $("script, style, iframe, form").remove();
  const body = $.html({ xml: true });
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`,
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

const chapterLabel = (title: string): string => {
  const number = chapterNumber(title);
  return number == null ? cleanText(title) : `Ch. ${number}`;
};

export const toFeaturedItem = (item: ListingItem): FeaturedCarouselItem => {
  const infoItems: NonNullable<FeaturedCarouselItem["infoItems"]>[number][] = [];
  if (item.rating != null) infoItems.push({ symbol: "star.fill", text: item.rating.toFixed(1) });
  if (item.type) infoItems.push({ symbol: "books.vertical.fill", text: item.type });
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: item.type ?? item.genres[0] ?? "Popular",
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
