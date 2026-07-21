/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import { type Cheerio, type CheerioAPI } from "cheerio";
import { type AnyNode } from "domhandler";

import {
  DOMAIN,
  LOCK_PREFIX,
  LOCK_SUFFIX,
  NONCE_REGEX,
  type ComicCard,
  type Genre,
} from "./models";

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

export const toSafeId = (slug: string): string => {
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

export const absoluteUrl = (src: string): string => {
  const s = (src || "").trim();
  if (!s) return "";
  if (s.startsWith("http")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return s.startsWith("/") ? `${DOMAIN}${s}` : `${DOMAIN}/${s}`;
};

const imageFromElement = ($: CheerioAPI, img: Cheerio<AnyNode>): string => {
  const src = img.attr("data-src") || img.attr("data-lazy-src") || img.attr("src") || "";
  return absoluteUrl(src);
};

export const extractNonce = ($: CheerioAPI): string | undefined => {
  const match = $.html().match(NONCE_REGEX);
  return match ? match[1] : undefined;
};

export const parsePinnedCards = ($: CheerioAPI): ComicCard[] => {
  const cards: ComicCard[] = [];
  const seen = new Set<string>();

  for (const element of $(".comics-flex-pinned a.pinned-comic-card").toArray()) {
    const el = $(element);
    const href = (el.attr("href") || "").trim();
    if (!href) continue;

    const mangaId = parsePath(href);
    if (!mangaId || seen.has(mangaId)) continue;

    const title = Application.decodeHTMLEntities(
      el.find(".pinned-comic-title").first().text().trim(),
    );
    if (!title) continue;

    seen.add(mangaId);
    cards.push({
      mangaId,
      title,
      imageUrl: imageFromElement($, el.find(".comic-thumbnail img").first()),
    });
  }

  return cards;
};

export const parseComicCards = ($: CheerioAPI): ComicCard[] => {
  const cards: ComicCard[] = [];
  const seen = new Set<string>();

  for (const element of $("article.ac-card").toArray()) {
    const card = $(element);
    const link = card.find(".ac-title a").first();
    const href = (link.attr("href") || "").trim();
    if (!href) continue;

    const mangaId = parsePath(href);
    if (!mangaId || seen.has(mangaId)) continue;

    const title = Application.decodeHTMLEntities(link.text().trim());
    if (!title) continue;

    seen.add(mangaId);
    cards.push({
      mangaId,
      title,
      imageUrl: imageFromElement($, card.find(".ac-thumb img").first()),
    });
  }

  return cards;
};

export const hasNextPage = ($: CheerioAPI): boolean => {
  return $(".ac-pagination a.next").length > 0;
};

export const parseGenres = ($: CheerioAPI): Genre[] => {
  const genres: Genre[] = [];
  const seen = new Set<string>();

  for (const element of $(".ac-filter-group.ac-genre input[name='genres[]']").toArray()) {
    const input = $(element);
    const slug = (input.attr("value") || "").trim();
    const name = Application.decodeHTMLEntities(
      input.parent().find(".ac-option-text").first().text().trim(),
    );
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
  for (const el of $(".comic-genres .genres .genre").toArray()) {
    const title = Application.decodeHTMLEntities($(el).text().trim());
    if (!title) continue;
    const id = title.toLowerCase().replace(/\s+/g, "-");
    if (seenGenre.has(id)) continue;
    seenGenre.add(id);
    genreTags.push({ id, title });
  }

  const synopsis = Application.decodeHTMLEntities($(".comic-synopsis").first().text().trim());
  const status = parseStatus($(".comic-status span:last-child").first().text());

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

const isLocked = ($: CheerioAPI, el: Cheerio<AnyNode>): boolean => {
  const reason = (el.attr("data-reason") || "").toLowerCase();
  if (reason && reason !== "free") return true;
  if (el.hasClass("locked-chapter")) return true;
  const href = el.find("a").first().attr("href") || "";
  if (!href || href === "#") return true;
  return el.find(".chapter_price").length > 0;
};

export const parseChapterElements = (
  $: CheerioAPI,
  elements: Cheerio<AnyNode>,
  sourceManga: SourceManga,
  hideLocked: boolean,
): Chapter[] => {
  const chapters: Chapter[] = [];

  elements.each((_, element) => {
    const el = $(element);
    const permalink = (el.attr("data-permalink") || "").trim();
    const href = el.find("a").first().attr("href") || "";
    const rawUrl = permalink || href;
    if (!rawUrl) return;

    const locked = isLocked($, el);
    if (locked && hideLocked) return;

    let name = Application.decodeHTMLEntities(
      el.find(".chapter-number").first().text().trim() || (el.attr("data-title") || "").trim(),
    );
    const dateText = el.find(".chapter-date").first().text().trim();

    let chapterId = parsePath(rawUrl);
    if (locked) {
      name = `${LOCK_PREFIX}${name}`;
      chapterId += LOCK_SUFFIX;
    }

    chapters.push({
      chapterId,
      sourceManga,
      title: name,
      volume: 0,
      chapNum: parseChapterNumber(name),
      publishDate: parseDate(dateText),
      langCode: "en",
    });
  });

  return chapters;
};

export const finalizeChapters = (chapters: Chapter[]): Chapter[] => {
  const total = chapters.length;
  return chapters.map((chapter, index) => ({
    ...chapter,
    chapNum: chapter.chapNum || total - index,
    sortingIndex: total - index,
  }));
};

export const parseChapterDetails = ($: CheerioAPI, chapter: Chapter): ChapterDetails => {
  const pages: string[] = [];
  for (const element of $("img.chapter-image").toArray()) {
    const el = $(element);
    const src = (el.attr("data-src") || el.attr("src") || "").trim();
    if (src) pages.push(absoluteUrl(src));
  }

  if (pages.length === 0) {
    throw new Error("Chapter is locked or unavailable.");
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};
