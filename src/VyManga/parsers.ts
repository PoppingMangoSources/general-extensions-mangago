/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import { type Cheerio, type CheerioAPI } from "cheerio";
import { type AnyNode } from "domhandler";

import {
  ADULT_GENRE_NAMES,
  ARTIST_SELECTOR,
  AUTHOR_SELECTOR,
  CARD_IMAGE_SELECTOR,
  CARD_LATEST_SELECTOR,
  CARD_LINK_SELECTOR,
  CARD_TITLE_SELECTOR,
  CHAPTER_DATE_SELECTOR,
  CHAPTER_NAME_SELECTOR,
  CHAPTER_SELECTOR,
  DESC_SELECTOR,
  GENRE_CHECKBOX_SELECTOR,
  GENRE_FILTER_SELECTOR,
  GENRE_SELECTOR,
  PAGE_SELECTOR,
  STATUS_SELECTOR,
  THUMB_SELECTOR,
  TITLE_SELECTOR,
  type MangaCard,
  type OptionItem,
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

// ---------------------------------------------------------------------------
// id / url / image helpers
// ---------------------------------------------------------------------------

// Paperback only permits IDs matching alphanumerics + `._-@()[]%?#+=/&:`.
export function toSafeId(value: string): string {
  return value.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
    const enc = encodeURIComponent(c);
    if (enc !== c) return enc;
    return "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
  });
}

export function safeDecode(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

// Both manga and chapter ids are the domain-relative path, so they survive a
// base-URL override and can be re-requested verbatim.
export function parsePath(href: string): string {
  const cleaned = (href || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
  return toSafeId(cleaned);
}

function absoluteUrl(base: string, src: string): string {
  const s = (src || "").trim();
  if (!s) return "";
  if (s.startsWith("http")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return s.startsWith("/") ? `${base}${s}` : `${base}/${s}`;
}

function imgAttr(base: string, img: Cheerio<AnyNode>): string {
  if (!img || img.length === 0) return "";
  const src =
    img.attr("data-src") ||
    img.attr("data-lazy-src") ||
    img.attr("data-cfsrc") ||
    img.attr("src") ||
    "";
  return absoluteUrl(base, src);
}

// ---------------------------------------------------------------------------
// listing / discover cards
// ---------------------------------------------------------------------------

export function parseCard($: CheerioAPI, base: string, element: AnyNode): MangaCard | undefined {
  const unit = $(element);
  const link = unit.find(CARD_LINK_SELECTOR).first();
  const href = (link.attr("href") || "").trim();
  if (!href) return undefined;

  const mangaId = parsePath(href);
  if (!mangaId) return undefined;

  const title = Application.decodeHTMLEntities(
    (unit.find(CARD_TITLE_SELECTOR).first().text() || link.attr("title") || "").trim(),
  );
  if (!title) return undefined;

  // The cover may sit on the <img> (lazy data-src) or as a background-image on
  // the wrapper div.
  const img = unit.find(CARD_IMAGE_SELECTOR).first();
  let imageUrl = imgAttr(base, img);
  if (!imageUrl) {
    const bg = unit.find(".comic-image").first().attr("data-background-image") || "";
    imageUrl = absoluteUrl(base, bg);
  }

  const latest = unit.find(CARD_LATEST_SELECTOR).first().text().trim();

  return {
    mangaId,
    title,
    imageUrl,
    subtitle: latest || undefined,
  };
}

export function parseCards($: CheerioAPI, base: string): MangaCard[] {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  for (const element of $(".comic-item").toArray()) {
    const card = parseCard($, base, element);
    if (card && !seen.has(card.mangaId)) {
      seen.add(card.mangaId);
      cards.push(card);
    }
  }
  return cards;
}

// ---------------------------------------------------------------------------
// genres (advanced-search checkboxes)
// ---------------------------------------------------------------------------

export function parseGenreFilter($: CheerioAPI): OptionItem[] {
  const genres: OptionItem[] = [];
  const seen = new Set<string>();
  for (const element of $(GENRE_FILTER_SELECTOR).toArray()) {
    const row = $(element);
    const id = (row.find(GENRE_CHECKBOX_SELECTOR).attr("data-value") || "").trim();
    const name = Application.decodeHTMLEntities(row.find("label").text().trim());
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    genres.push({ id, value: name });
  }
  return genres;
}

// ---------------------------------------------------------------------------
// details
// ---------------------------------------------------------------------------

function collectText($: CheerioAPI, selector: string): string[] {
  const out: string[] = [];
  $(selector).each((_, el) => {
    const t = $(el).text().trim();
    if (t && t !== "-" && t.toLowerCase() !== "n/a" && t.toLowerCase() !== "updating") out.push(t);
  });
  return out;
}

export function parseMangaDetails(
  $: CheerioAPI,
  base: string,
  mangaId: string,
  shareUrl: string,
  defaultRating: ContentRating,
): SourceManga {
  const primaryTitle = Application.decodeHTMLEntities(
    $(TITLE_SELECTOR).first().text().trim() || safeDecode(mangaId),
  );
  const thumbnailUrl = imgAttr(base, $(THUMB_SELECTOR).first());

  let synopsis = "";
  $(DESC_SELECTOR).each((_, el) => {
    const t = $(el).text().trim();
    if (t) synopsis += (synopsis ? "\n" : "") + t;
  });
  synopsis = Application.decodeHTMLEntities(synopsis);

  const author = collectText($, AUTHOR_SELECTOR).join(", ") || undefined;
  const artist = collectText($, ARTIST_SELECTOR).join(", ") || undefined;

  const genreTags: Tag[] = [];
  const seenGenre = new Set<string>();
  $(GENRE_SELECTOR).each((_, el) => {
    const anchor = $(el);
    const title = Application.decodeHTMLEntities(anchor.text().trim());
    if (!title) return;
    const id = genreIdFromAnchor(anchor.attr("href") || "", title);
    if (seenGenre.has(id)) return;
    seenGenre.add(id);
    genreTags.push({ id, title });
  });
  const tagGroups: TagSection[] =
    genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

  const isAdult = genreTags.some((tag) => ADULT_GENRE_NAMES.has(tag.title.trim().toLowerCase()));

  const status = parseStatus($(STATUS_SELECTOR).last().text().trim());

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles: [],
      thumbnailUrl,
      synopsis,
      author,
      artist,
      status,
      contentRating: isAdult ? ContentRating.ADULT : defaultRating,
      tagGroups,
      shareUrl,
    },
  };
}

// The genre id used by the search filter is the numeric value at the end of the
// details genre link; fall back to a slug so a tapped tag still searches.
function genreIdFromAnchor(href: string, title: string): string {
  const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const last = cleaned.split("/").pop() || "";
  if (/^\d+$/.test(last)) return last;
  const query = href.match(/genre(?:\[\])?=(\d+)/);
  if (query) return query[1];
  return title.toLowerCase().replace(/\s+/g, "-");
}

function parseStatus(status: string): string {
  const s = (status || "").toLowerCase().trim();
  if (!s) return "Unknown";
  if (s.includes("complet") || s.includes("finish")) return "Completed";
  if (s.includes("ongoing") || s.includes("on going") || s.includes("updating")) return "Ongoing";
  if (s.includes("hiatus") || s.includes("pause")) return "Hiatus";
  if (s.includes("cancel") || s.includes("drop")) return "Cancelled";
  return "Unknown";
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];
  for (const element of $(CHAPTER_SELECTOR).toArray()) {
    const el = $(element);
    const href = (el.attr("href") || el.find("a").first().attr("href") || "").trim();
    if (!href) continue;

    const chapterId = parsePath(href);
    if (!chapterId) continue;

    const title = Application.decodeHTMLEntities(
      el.find(CHAPTER_NAME_SELECTOR).first().text().trim() || el.text().trim(),
    );
    const chapNum = parseChapterNumber(title);
    const dateText = el.find(CHAPTER_DATE_SELECTOR).first().text().trim();

    chapters.push({
      chapterId,
      sourceManga,
      title,
      volume: 0,
      chapNum,
      publishDate: dateText ? parseDate(dateText) : undefined,
      langCode: "en",
    });
  }

  return chapters.map((chapter, index) => ({
    ...chapter,
    sortingIndex: chapters.length - index,
  }));
}

function parseChapterNumber(name: string): number {
  const m = name.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i) ?? name.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

export function parseChapterPages($: CheerioAPI, base: string): string[] {
  const pages: string[] = [];
  for (const element of $(PAGE_SELECTOR).toArray()) {
    const image = imgAttr(base, $(element));
    if (image) pages.push(image);
  }
  return [...new Set(pages)];
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

// Handles the chapter-list absolute format ("Jan 05, 2024") and the relative
// times ("2 days ago", "5 hours ago") deterministically across engines
// (JavaScriptCore on iOS is stricter than V8 about date strings).
export function parseDate(text: string): Date {
  const trimmed = (text || "").trim();
  if (!trimmed) return new Date();

  const abs = trimmed.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (abs) {
    const month = MONTHS[abs[1].toLowerCase()];
    if (month !== undefined) {
      return new Date(Date.UTC(parseInt(abs[3], 10), month, parseInt(abs[2], 10)));
    }
  }

  const rel = trimmed.toLowerCase().match(/(\d+)\s*(second|min|hour|day|week|month|year)/);
  if (rel) {
    const amount = parseInt(rel[1], 10);
    const now = Date.now();
    const unit = rel[2];
    const ms =
      unit === "second"
        ? 1000
        : unit === "min"
          ? 60_000
          : unit === "hour"
            ? 3_600_000
            : unit === "day"
              ? 86_400_000
              : unit === "week"
                ? 604_800_000
                : unit === "month"
                  ? 2_592_000_000
                  : 31_536_000_000;
    return new Date(now - amount * ms);
  }

  const direct = new Date(trimmed);
  return isNaN(direct.getTime()) ? new Date() : direct;
}
