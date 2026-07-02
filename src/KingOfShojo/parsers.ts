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
  ALT_NAME_SELECTOR,
  ARTIST_SELECTOR,
  AUTHOR_SELECTOR,
  CHAPTER_DATE_SELECTOR,
  CHAPTER_NAME_SELECTOR,
  CHAPTER_SELECTOR,
  DESC_SELECTOR,
  DETAILS_SCOPE,
  GENRE_FILTER_SELECTOR,
  GENRE_SELECTOR,
  IMAGE_LIST_REGEX,
  MANGA_DIR,
  PAGE_SELECTOR,
  STATUS_SELECTOR,
  THUMB_SELECTOR,
  TITLE_SELECTOR,
  type LatestCard,
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
export function toSafeId(slug: string): string {
  return slug.replace(/[^A-Za-z0-9._\-@()[\]%?#+=/&:]/g, (c) => {
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

// The manga slug: the segment right after `/manga/`.
export function parseMangaId(href: string): string {
  const cleaned = href.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const marker = `/${MANGA_DIR}/`;
  const idx = cleaned.indexOf(marker);
  const slug =
    idx !== -1
      ? cleaned.slice(idx + marker.length).split("/")[0]
      : (cleaned.split("/").pop() ?? "");
  return toSafeId(slug);
}

// Chapters keep the full domain-relative path so they can be requested verbatim
// (chapter URLs are flat: `{baseUrl}/{chapter-slug}/`).
export function parseChapterId(href: string): string {
  const cleaned = href
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
  let src = img.attr("data-lazy-src") || img.attr("data-src") || img.attr("data-cfsrc") || "";
  if (!src) {
    const srcset = img.attr("srcset");
    if (srcset) {
      const best = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/))
        .map(([u, w]) => ({ url: u, width: parseInt((w || "0").replace(/\D/g, ""), 10) || 0 }))
        .sort((a, b) => b.width - a.width)[0];
      if (best) src = best.url;
    }
  }
  if (!src) src = img.attr("src") || "";
  return absoluteUrl(base, src);
}

// ---------------------------------------------------------------------------
// card parsers (browse/search + discover widgets share the `.bsx` card)
// ---------------------------------------------------------------------------

function cardTitle($: CheerioAPI, unit: Cheerio<AnyNode>, link: Cheerio<AnyNode>): string {
  const img = unit.find("img").first();
  const raw =
    unit.find(".bigor .tt a, .tt").first().text().trim() ||
    img.attr("title") ||
    link.attr("title") ||
    link.text();
  return Application.decodeHTMLEntities((raw || "").trim());
}

export function parseCard($: CheerioAPI, base: string, element: AnyNode): MangaCard | undefined {
  const unit = $(element);
  const link = unit.is("a") ? unit : unit.find("a").first();
  const href = (link.attr("href") || "").trim();
  if (!href) return undefined;

  const mangaId = parseMangaId(href);
  if (!mangaId) return undefined;

  const title = cardTitle($, unit, link);
  if (!title) return undefined;

  const rating = unit.find(".numscore").first().text().trim();
  const chapter = unit.find(".epxs").first().text().trim();
  const subtitle = rating ? `★ ${rating}` : chapter || undefined;

  return {
    mangaId,
    title,
    imageUrl: imgAttr(base, unit.find("img").first()),
    subtitle,
    rating: rating || undefined,
  };
}

export function parseCards($: CheerioAPI, base: string, selector: string): MangaCard[] {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  for (const element of $(selector).toArray()) {
    const card = parseCard($, base, element);
    if (card && !seen.has(card.mangaId)) {
      seen.add(card.mangaId);
      cards.push(card);
    }
  }
  return cards;
}

// Finds a homepage widget by its heading text and returns its container.
function widgetByHeading($: CheerioAPI, heading: string): Cheerio<AnyNode> {
  return $(`.releases:contains("${heading}")`).first().closest(".bixbox, .section");
}

export function parsePopularToday($: CheerioAPI, base: string): MangaCard[] {
  const scope = widgetByHeading($, "Popular Today");
  return dedupeCards(
    scope
      .find(".bsx")
      .toArray()
      .map((el) => parseCard($, base, el)),
  );
}

export function parseRecommendation($: CheerioAPI, base: string): MangaCard[] {
  const scope = widgetByHeading($, "Recommendation");
  return dedupeCards(
    scope
      .find(".bsx")
      .toArray()
      .map((el) => parseCard($, base, el)),
  );
}

// "Popular Series" — the ranked wpop widget. `rangeClass` selects the tab
// (wpop-weekly | wpop-monthly | wpop-alltime); all three ship in the HTML.
export function parsePopularSeries(
  $: CheerioAPI,
  base: string,
  rangeClass = "wpop-weekly",
  showAdult = true,
): MangaCard[] {
  const scope = widgetByHeading($, "Popular Series");
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  for (const element of scope
    .find(`.serieslist.${rangeClass} ul li, #wpop-items .${rangeClass} ul li`)
    .toArray()) {
    const li = $(element);
    const link = li.find("a.series").first();
    const href = (link.attr("href") || "").trim();
    if (!href) continue;
    const mangaId = parseMangaId(href);
    if (!mangaId || seen.has(mangaId)) continue;
    const title = Application.decodeHTMLEntities(
      (
        li.find(".leftseries h2 a, .leftseries a.series").first().text() ||
        link.attr("title") ||
        ""
      ).trim(),
    );
    if (!title) continue;

    // Popular Series rows list their genres inline, so honor the adult toggle
    // right here — the only discover widget where a per-card signal exists.
    const isAdult = li
      .find('a[href*="/genres/"]')
      .toArray()
      .some((genre) => ADULT_GENRE_NAMES.has($(genre).text().trim().toLowerCase()));
    if (isAdult && !showAdult) continue;

    seen.add(mangaId);
    const rating = li.find(".numscore").first().text().trim();
    cards.push({
      mangaId,
      title,
      imageUrl: imgAttr(base, li.find("img").first()),
      subtitle: rating ? `★ ${rating}` : undefined,
      rating: rating || undefined,
      isAdult,
    });
  }
  return cards;
}

// "Latest Update" — cards carry their newest chapter (link + relative time).
export function parseLatestUpdate($: CheerioAPI, base: string): LatestCard[] {
  const scope = widgetByHeading($, "Latest Update");
  const cards: LatestCard[] = [];
  const seen = new Set<string>();
  for (const element of scope.find(".bsx").toArray()) {
    const card = parseCard($, base, element);
    if (!card || seen.has(card.mangaId)) continue;
    seen.add(card.mangaId);

    const firstChapter = $(element).find("ul.chfiv li a").first();
    const chapterHref = (firstChapter.attr("href") || "").trim();
    const chapterName = firstChapter.find(".fivchap").text().trim();
    const timeText = firstChapter.find(".fivtime").text().trim();

    cards.push({
      ...card,
      subtitle: chapterName || card.subtitle,
      chapterId: chapterHref ? parseChapterId(chapterHref) : undefined,
      chapterName: chapterName || undefined,
      publishDate: timeText ? parseDate(timeText) : undefined,
    });
  }
  return cards;
}

function dedupeCards(cards: (MangaCard | undefined)[]): MangaCard[] {
  const out: MangaCard[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (card && !seen.has(card.mangaId)) {
      seen.add(card.mangaId);
      out.push(card);
    }
  }
  return out;
}

export function hasNextPage($: CheerioAPI, selector: string): boolean {
  return $(selector).length > 0;
}

// ---------------------------------------------------------------------------
// genres (browse-page filter checkboxes)
// ---------------------------------------------------------------------------

export function parseGenreFilter($: CheerioAPI): OptionItem[] {
  const genres: OptionItem[] = [];
  const seen = new Set<string>();
  for (const element of $(GENRE_FILTER_SELECTOR).toArray()) {
    const li = $(element);
    const id = (li.find("input[type=checkbox]").attr("value") || "").trim();
    const name = Application.decodeHTMLEntities(li.find("label").text().trim());
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    genres.push({ id, value: name });
  }
  return genres;
}

// ---------------------------------------------------------------------------
// details
// ---------------------------------------------------------------------------

function collectText($: CheerioAPI, scope: Cheerio<AnyNode>, selector: string): string[] {
  const out: string[] = [];
  scope.find(selector).each((_, el) => {
    const t = $(el).text().trim();
    if (t && t !== "-" && t.toLowerCase() !== "n/a") out.push(t);
  });
  return out;
}

export function parseMangaDetails(
  $: CheerioAPI,
  base: string,
  mangaId: string,
  shareUrl: string,
  contentRating: ContentRating,
): SourceManga {
  const details = $(DETAILS_SCOPE).first();
  const scope = details.length > 0 ? details : $("html");

  const primaryTitle = Application.decodeHTMLEntities(
    scope.find(TITLE_SELECTOR).first().text().trim() || safeDecode(mangaId),
  );
  const thumbnailUrl = imgAttr(base, scope.find(THUMB_SELECTOR).first());

  let synopsis = "";
  scope.find(DESC_SELECTOR).each((_, el) => {
    const t = $(el).text().trim();
    if (t) synopsis += (synopsis ? "\n" : "") + t;
  });
  synopsis = Application.decodeHTMLEntities(synopsis);

  const secondaryTitles: string[] = [];
  const altName = scope.find(ALT_NAME_SELECTOR).first().text().trim();
  if (altName) {
    for (const t of altName.split(/[,;|]/)) {
      const trimmed = Application.decodeHTMLEntities(t.trim());
      if (trimmed) secondaryTitles.push(trimmed);
    }
  }

  const author = collectText($, scope, AUTHOR_SELECTOR).join(", ") || undefined;
  const artist = collectText($, scope, ARTIST_SELECTOR).join(", ") || undefined;

  const genreTags: Tag[] = [];
  const seenGenre = new Set<string>();
  scope.find(GENRE_SELECTOR).each((_, el) => {
    const title = Application.decodeHTMLEntities($(el).text().trim());
    if (!title) return;
    const id = title.toLowerCase().replace(/\s+/g, "-");
    if (seenGenre.has(id)) return;
    seenGenre.add(id);
    genreTags.push({ id, title });
  });
  const tagGroups: TagSection[] =
    genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

  // Adult-tagged titles report ADULT so Paperback's own content filter applies.
  const effectiveRating = genreTags.some((tag) =>
    ADULT_GENRE_NAMES.has(tag.title.trim().toLowerCase()),
  )
    ? ContentRating.ADULT
    : contentRating;

  const status = parseStatus(scope.find(STATUS_SELECTOR).first().text().trim());

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl,
      synopsis,
      author,
      artist,
      status,
      contentRating: effectiveRating,
      tagGroups,
      shareUrl,
    },
  };
}

function parseStatus(status: string): string {
  const s = (status || "").toLowerCase().trim();
  if (!s) return "Unknown";
  if (s.includes("complet") || s.includes("finished") || s.includes("tamat")) return "Completed";
  if (
    s.includes("ongoing") ||
    s.includes("on going") ||
    s.includes("publishing") ||
    s.includes("updating")
  )
    return "Ongoing";
  if (s.includes("hiatus") || s.includes("hold") || s.includes("pause")) return "Hiatus";
  if (s.includes("cancel") || s.includes("drop") || s.includes("discontin")) return "Cancelled";
  return "Unknown";
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];
  for (const element of $(CHAPTER_SELECTOR).toArray()) {
    const el = $(element);
    const link = el.is("a") ? el : el.find("a").first();
    const href = (link.attr("href") || "").trim();
    if (!href) continue;

    const chapterId = parseChapterId(href);
    if (!chapterId) continue;

    const title = Application.decodeHTMLEntities(
      el.find(CHAPTER_NAME_SELECTOR).text().trim() || link.text().trim(),
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

  // Fallback: some readers embed the image list as JSON (ts_reader).
  if (pages.length === 0) {
    const html = $.root().html() || "";
    const match = html.match(IMAGE_LIST_REGEX);
    if (match) {
      try {
        for (const entry of JSON.parse(match[1]) as unknown[]) {
          if (typeof entry === "string") {
            const u = entry.trim().replace(/\\\//g, "/");
            if (u) pages.push(absoluteUrl(base, u));
          }
        }
      } catch {
        // ignore malformed JSON
      }
    }
  }

  return [...new Set(pages)];
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

// Handles both the chapter-list format ("January 5, 2024") and the homepage
// relative times ("10 minutes", "5 days ago"), deterministically across
// engines (JavaScriptCore on iOS is stricter than V8 about date strings).
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
