/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { type Cheerio, type CheerioAPI } from "cheerio";
import { type AnyNode } from "domhandler";

import { DOMAIN, LOCK_SUFFIX, type ComicCard, type Genre } from "./models";
import { decodePageUrls } from "./utils";

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const toSafeId = (slug: string): string => {
  return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
    const enc = encodeURIComponent(c);
    if (enc !== c) return enc;
    return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
  });
};

export const safeDecode = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

export const parsePath = (href: string): string => {
  const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const slug = cleaned.startsWith("http")
    ? cleaned.replace(/^https?:\/\/[^/]+\//, "")
    : cleaned.replace(/^\/+/, "");
  return toSafeId(slug);
};

const absoluteUrl = (src: string): string => {
  const s = (src || "").trim();
  if (!s) return "";
  if (s.startsWith("http")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return s.startsWith("/") ? `${DOMAIN}${s}` : `${DOMAIN}/${s}`;
};

const imageUrlFromElement = (img: Cheerio<AnyNode>): string => {
  const src = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src") || "";
  return absoluteUrl(src);
};

export const extractNonce = ($: CheerioAPI): string | undefined => {
  const match = $.html().match(/comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/);
  return match ? match[1] : undefined;
};

const parseRelativeDate = (text: string): Date | undefined => {
  const match = text
    .trim()
    .match(/^(\d+)\s*(m(?:in)?|h(?:our)?|d(?:ay)?|w(?:eek)?|mo(?:nth)?|y(?:ear)?)(?:s| ago)?$/i);
  if (!match) return undefined;
  const scale: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    mo: 2_629_800_000,
    y: 31_557_600_000,
  };
  const unit = match[2].toLowerCase();
  return new Date(Date.now() - Number(match[1]) * scale[unit.startsWith("mo") ? "mo" : unit[0]]);
};

export const toHotItems = ($: CheerioAPI): DiscoverSectionItem[] =>
  $("[data-cw-slider] [data-slide]")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const mangaId = parsePath(
        card.find("a[href*='/comic/'], a[href*='/novel/']").first().attr("href") ?? "",
      );
      const title = Application.decodeHTMLEntities(card.find("h2").first().text().trim());
      const imageUrl = imageUrlFromElement(card.find("img").first());
      if (!mangaId || !title || !imageUrl) return [];
      const genres = card
        .find(".chip")
        .map((_, genre) => $(genre).text().trim())
        .get();
      return [
        {
          type: "featuredCarouselItem",
          mangaId,
          title,
          imageUrl,
          infoItems: genres.length
            ? [{ symbol: "tag.fill", text: genres.slice(0, 3).join(", ") }]
            : undefined,
          summary: Application.decodeHTMLEntities(card.find("p").last().text().trim()) || undefined,
          contentRating: ContentRating.EVERYONE,
        },
      ];
    });

export const toPinnedItems = ($: CheerioAPI): DiscoverSectionItem[] =>
  $("section[aria-labelledby='cw-week-m'] a")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const mangaId = parsePath(card.attr("href") ?? "");
      const title = Application.decodeHTMLEntities(card.find(".line-clamp-2").text().trim());
      const imageUrl = imageUrlFromElement(card.find("img").first());
      if (!mangaId || !title || !imageUrl) return [];
      return [
        {
          type: "prominentCarouselItem",
          mangaId,
          title,
          imageUrl,
          contentRating: ContentRating.EVERYONE,
        },
      ];
    });

export const toLatestItems = ($: CheerioAPI): DiscoverSectionItem[] =>
  $("#cw-latest article")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const link = card.find("a.line-clamp-2").first();
      const mangaId = parsePath(link.attr("href") ?? "");
      const title = Application.decodeHTMLEntities(link.text().trim());
      const imageUrl = imageUrlFromElement(card.find("img").first());
      const chapter = card
        .find("a.chapter-item")
        .toArray()
        .map((node) => $(node))
        .find((node) => !isLocked(node));
      if (!mangaId || !title || !imageUrl || !chapter) return [];
      return [
        {
          type: "chapterUpdatesCarouselItem",
          mangaId,
          title,
          imageUrl,
          chapterId: parsePath(chapter.attr("href") ?? ""),
          subtitle: chapter.children("span").first().text().trim(),
          publishDate: parseRelativeDate(chapter.children("span").last().text().trim()),
          contentRating: ContentRating.EVERYONE,
        },
      ];
    });

export const toNovelItems = ($: CheerioAPI): DiscoverSectionItem[] =>
  $("section[aria-labelledby='cw-novels'] a.group")
    .toArray()
    .flatMap((el) => {
      const card = $(el);
      const mangaId = parsePath(card.attr("href") ?? "");
      const title = Application.decodeHTMLEntities(card.find(".line-clamp-2").text().trim());
      const imageUrl = imageUrlFromElement(card.find("img").first());
      if (!mangaId || !title || !imageUrl) return [];
      return [
        {
          type: "simpleCarouselItem",
          mangaId,
          title,
          imageUrl,
          contentRating: ContentRating.EVERYONE,
        },
      ];
    });

export const parseComicCards = ($: CheerioAPI): ComicCard[] => {
  const cards: ComicCard[] = [];
  const seen = new Set<string>();

  for (const element of $("#cwBrowse ul > li").toArray()) {
    const card = $(element);
    const link = card.find("a").first();
    const href = (link.attr("href") || "").trim();
    if (!href) continue;

    const mangaId = parsePath(href);
    if (!mangaId || seen.has(mangaId)) continue;

    const title = Application.decodeHTMLEntities(link.find(".line-clamp-2").text().trim());
    if (!title) continue;

    seen.add(mangaId);
    cards.push({
      mangaId,
      title,
      imageUrl: imageUrlFromElement(card.find("img").first()),
    });
  }

  return cards;
};

export const hasNextPage = ($: CheerioAPI): boolean => {
  return $("#cwBrowse a.next, #cwBrowse a[rel=next]").length > 0;
};

export const parseGenres = ($: CheerioAPI): Genre[] => {
  const genres: Genre[] = [];
  const seen = new Set<string>();

  for (const element of $("#cwBrowse input[name='genres[]']").toArray()) {
    const input = $(element);
    const slug = (input.attr("value") || "").trim();
    const name = Application.decodeHTMLEntities(input.parent().find("span").first().text().trim());
    if (!slug || !name || seen.has(slug)) continue;
    seen.add(slug);
    genres.push({ slug, name });
  }

  return genres;
};

export const genresToTagSection = (genres: Genre[]): TagSection => {
  const tags: Tag[] = genres.map((genre) => ({ id: genre.slug, title: genre.name }));
  return { id: "genres", title: "Genres", tags };
};

const parseStatus = (status: string): string => {
  const s = (status || "").trim().toLowerCase();
  if (s.includes("ongoing")) return "Ongoing";
  if (s.includes("completed")) return "Completed";
  if (s.includes("hiatus")) return "Hiatus";
  if (s.includes("cancel")) return "Cancelled";
  return "Unknown";
};

export const parseMangaDetails = ($: CheerioAPI, mangaId: string): SourceManga => {
  const primaryTitle = Application.decodeHTMLEntities(
    $(".comic-info-upper h1").first().text().trim() ||
      $("h1.novel-title").first().text().trim() ||
      $("h1").first().text().trim() ||
      safeDecode(mangaId),
  );

  const thumbnailUrl = absoluteUrl($("meta[property=og:image]").first().attr("content") || "");

  const authors: string[] = [];
  for (const el of $(".comic-graph > span").toArray()) {
    const text = $(el).text().trim();
    if (text && text !== "•" && !authors.includes(text)) authors.push(text);
  }

  const genreTags: Tag[] = [];
  const seenGenre = new Set<string>();
  for (const el of $(
    "#main a[href*='/comics_genres/'], #main a[href*='/novel_genres/']",
  ).toArray()) {
    const title = Application.decodeHTMLEntities($(el).text().trim());
    if (!title) continue;
    const id = title.toLowerCase().replace(/\s+/g, "-");
    if (seenGenre.has(id)) continue;
    seenGenre.add(id);
    genreTags.push({ id, title });
  }

  const synopsis = Application.decodeHTMLEntities(
    $("#cwSynopsis, .comic-synopsis").first().text().trim() ||
      $(".novel-synopsis").first().text().trim() ||
      $("meta[property=og:description]").first().attr("content") ||
      "",
  );
  const status = parseStatus(
    $("#main dt")
      .filter((_, el) => $(el).text().trim() === "Status")
      .next("dd")
      .text(),
  );

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles: [],
      thumbnailUrl,
      synopsis,
      author: authors[0],
      artist: authors[1],
      status,
      contentRating: ContentRating.EVERYONE,
      contentType: safeDecode(mangaId).startsWith("novel/") ? "novel" : "comic",
      tagGroups: genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [],
      shareUrl: `${DOMAIN}/${safeDecode(mangaId).replace(/^\/+/, "")}`,
    },
  };
};

const parseChapterNumber = (name: string): number => {
  const m = name.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
};

const parseDate = (text: string): Date => {
  const trimmed = (text || "").trim();
  if (!trimmed) return new Date(0);

  const match = trimmed.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month !== undefined) {
      return new Date(Date.UTC(parseInt(match[3], 10), month, parseInt(match[2], 10)));
    }
  }

  const parsed = Date.parse(trimmed);
  return isNaN(parsed) ? new Date(0) : new Date(parsed);
};

const elementHref = (el: Cheerio<AnyNode>): string => {
  const own = (el.attr("href") || "").trim();
  if (own) return own;
  return (el.find("a").first().attr("href") || "").trim();
};

const isLocked = (el: Cheerio<AnyNode>): boolean => {
  const reason = (el.attr("data-reason") || "").toLowerCase();
  if (reason && reason !== "free") return true;
  if (el.hasClass("locked-chapter") || el.hasClass("is-locked")) return true;
  const href = elementHref(el);
  if (!href || href === "#") return true;
  return el.find(".chapter_price").length > 0;
};

export const parseChapterElements = (
  $: CheerioAPI,
  elements: Cheerio<AnyNode>,
  sourceManga: SourceManga,
): Chapter[] => {
  const chapters: Chapter[] = [];

  elements.each((_, element) => {
    const el = $(element);
    const permalink = (el.attr("data-permalink") || "").trim();
    const href = elementHref(el);
    const rawUrl = (permalink !== "#" ? permalink : "") || (href !== "#" ? href : "");
    const postId = (el.attr("data-post-id") || "").trim();
    if (!rawUrl && !postId) return;

    const locked = isLocked(el);

    const name = Application.decodeHTMLEntities(
      el.find(".chapter-number").first().text().trim() ||
        el.find(".ch-name").first().text().trim() ||
        el.find(".chapter-side-title").first().text().trim() ||
        el.find("label").first().text().trim() ||
        el.children("span").first().children("span").first().text().trim() ||
        (el.attr("data-title") || "").trim(),
    );
    const chapNum = parseChapterNumber(name);
    let title = name.replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "").trim();
    const dateText = (
      el.find(".chapter-date").first().text() ||
      el.children("span").first().children("span").last().text()
    )
      .split("·")[0]
      .trim();

    // Locked chapters (e.g. on novel pages) may expose no URL at all; a
    // synthetic id keeps them listed while staying unreadable.
    let chapterId = rawUrl ? parsePath(rawUrl) : `locked-${postId}`;
    if (locked) {
      title = title ? `${title} (LOCKED)` : "(LOCKED)";
      chapterId += LOCK_SUFFIX;
    }

    chapters.push({
      chapterId,
      sourceManga,
      title,
      volume: 0,
      chapNum,
      publishDate: dateText ? parseDate(dateText) : undefined,
      langCode: "en",
    });
  });

  return chapters;
};

export const finalizeChapters = (chapters: Chapter[]): Chapter[] => {
  const total = chapters.length;
  return chapters.map((chapter, index) => ({
    ...chapter,
    chapNum: chapter.chapNum,
    sortingIndex: total - index,
  }));
};

// Readium parses novel chapters as XHTML, so serialize with self-closed void
// tags before wrapping.
const toXhtml = (fragment: string): string => {
  const body = cheerio.load(fragment, null, false).html({ xml: true });
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
};

export const parseChapterDetails = ($: CheerioAPI, chapter: Chapter): ChapterDetails => {
  const encoded = $("#cwPages").text().trim();
  if (encoded) {
    const pages = decodePageUrls(encoded);
    if (pages.length === 0) throw new Error("RinkoComics returned an empty page list.");
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }
  const pages: string[] = [];
  for (const element of $("img.chapter-image").toArray()) {
    const el = $(element);
    const src = (el.attr("data-src") || el.attr("src") || "").trim();
    if (src) pages.push(absoluteUrl(src));
  }
  if (pages.length > 0) {
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // Novel chapters carry prose instead of images.
  const prose =
    $("#cwNovelText, #textContent").first().html() ?? $(".novel-content").first().html();
  if (prose?.trim()) {
    const heading = $(".chapter-title-head").first().text().trim();
    const body =
      (heading
        ? cheerio.load("<h2></h2>", null, false)("h2").text(heading).prop("outerHTML")
        : "") + prose.replaceAll("&nbsp;", " ");
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: toXhtml(body),
    };
  }

  throw new Error("RinkoComics returned no readable pages or text for this chapter.");
};
