/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, type Chapter, type SourceManga, type TagSection } from "@paperback/types";
import { type Cheerio, type CheerioAPI } from "cheerio";
import { type Element } from "domhandler";

import { DOMAIN, GENRES, LANGUAGES } from "./models";

const READER_TOKEN_REGEX = /readerToken["']?\s*:\s*["']([^"']+)["']/;
const PAGE_ORDER_REGEX = /["']?order["']?\s*:\s*(\d+)/g;
const CHAPTER_NUMBER_REGEX = /(\d+(?:\.\d+)?)/;

const TYPE_BADGES = new Set(["manga", "manhwa", "manhua", "shounen", "seinen", "shoujo", "josei"]);

const GENRE_ID_BY_TITLE = new Map(GENRES.map((g) => [g.title.toLowerCase(), g.id]));
const LANG_CODE_BY_BADGE = new Map(LANGUAGES.map((l) => [l.badge.toUpperCase(), l.langCode]));

// iOS swaps straight quotes for curly ones; the site only matches the straight
// forms, so normalize before searching.
export function straightenQuotes(value: string): string {
  return value.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
}

function resolveUrl(src: string): string {
  if (!src) return "";
  if (src.startsWith("http")) return src;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${DOMAIN}${src}`;
  return `${DOMAIN}/${src}`;
}

function resolveImageUrl($el: Cheerio<Element>): string {
  const src = $el.attr("data-src") || $el.attr("data-lazy-src") || $el.attr("src") || "";
  if (!src || src.startsWith("data:")) return "";
  return resolveUrl(src);
}

export function mangaIdFromHref(href: string): string {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  const after = path.split("/manga/")[1] ?? "";
  return after.replace(/^\/+|\/+$/g, "");
}

export function chapterIdFromHref(href: string): string {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  return path.startsWith("/") ? path : `/${path}`;
}

export interface MangaCard {
  mangaId: string;
  title: string;
  imageUrl: string;
  contentRating: ContentRating;
  genres?: string;
  views?: string;
}

// View counts appear on the trending rows ("20,558 views"); the genre line is on
// every card. Star ratings are NOT rendered in browse/home card markup (they only
// live on the dedicated top-manga page), so cards fall back to genres.
function extractCardViews(text: string): string | undefined {
  const match = text.match(/(\d[\d.,]*\s*[KMB]?)\s*(?:views|reads)\b/i);
  return match ? match[1].trim() : undefined;
}

export function buildStatSubtitle(card: MangaCard): string | undefined {
  if (card.views) return `${card.views} views`;
  return card.genres || undefined;
}

export function parseMangaCards($: CheerioAPI, showNsfw: boolean): MangaCard[] {
  const cards: MangaCard[] = [];

  $("div.relative.group").each((_, element) => {
    const card = $(element);

    const isAdult = card.find("span:contains('18+')").length > 0;
    if (isAdult && !showNsfw) return;

    const link = card.find("a[href*='/manga/']").first();
    const href = link.attr("href") ?? "";
    const mangaId = mangaIdFromHref(href);
    if (!mangaId) return;

    const titleEl = card.find("a[title]").first();
    const title = (titleEl.attr("title") || card.find("h3").first().text() || link.text()).trim();
    if (!title) return;

    const imageUrl = resolveImageUrl(card.find("img").first());
    const genres =
      card.find('[class*="text-accent/50"]').first().text().replace(/\s+/g, " ").trim() ||
      undefined;
    const views = extractCardViews(card.text());

    cards.push({
      mangaId,
      title,
      imageUrl,
      contentRating: isAdult ? ContentRating.ADULT : ContentRating.EVERYONE,
      genres,
      views,
    });
  });

  return cards;
}

// ============================= Top-manga ranking =============================
// The /top-manga page ranks every title by total reads (?sort=reads) or by
// rating (?sort=rated). Unlike /browse, its rows carry BOTH the read count and
// the ★ rating, so the featured hero and the Highest Rated carousel source here.
export interface TopMangaItem {
  mangaId: string;
  title: string;
  imageUrl: string;
  contentRating: ContentRating;
  genres?: string;
  reads?: string;
  rating?: string;
}

const ADULT_GENRE_REGEX = /\b(adult|mature|smut|ecchi|hentai)\b/i;

function cleanGenreLine(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*[·/]\s*/g, " · ")
    .trim();
}

function ratingValue(text: string): string | undefined {
  return text.match(/\d+(?:\.\d+)?/)?.[0];
}

export function parseTopManga($: CheerioAPI, showNsfw: boolean): TopMangaItem[] {
  const items: TopMangaItem[] = [];
  const seen = new Set<string>();

  const add = (item: TopMangaItem | undefined): void => {
    if (!item || !item.mangaId || !item.title || seen.has(item.mangaId)) return;
    if (item.contentRating === ContentRating.ADULT && !showNsfw) return;
    seen.add(item.mangaId);
    items.push(item);
  };

  // Podium (ranks 1-3): poster anchors in the lead section. Title comes from the
  // image alt ("<title> cover"); the read count sits in a "N reads" line. These
  // cards carry no rating or genre.
  $("section a[href*='/manga/']").each((_, el) => {
    const a = $(el);
    const img = a.find("img").first();
    if (img.length === 0) return;
    const readsMatch = a.text().match(/([\d,]+)\s*reads/i);
    if (!readsMatch) return;

    add({
      mangaId: mangaIdFromHref(a.attr("href") ?? ""),
      title: (img.attr("alt") ?? "").replace(/\s*cover\s*$/i, "").trim(),
      imageUrl: resolveImageUrl(img),
      contentRating: ContentRating.EVERYONE,
      reads: readsMatch[1],
    });
  });

  // Ranked list (rank 4+): each <li> wraps a grid anchor with rank, poster,
  // title, status, genres, and a right-aligned stat block (reads then ★ rating).
  $("ol li a[href*='/manga/']").each((_, el) => {
    const a = $(el);
    const genres = cleanGenreLine(a.find('[class*="text-accent/45"]').first().text()) || undefined;
    const stats = a
      .find('[class*="text-right"]')
      .first()
      .children("span")
      .map((_, s) => $(s).text().trim())
      .get();

    add({
      mangaId: mangaIdFromHref(a.attr("href") ?? ""),
      title: a.find('[class*="line-clamp-1"]').first().text().trim(),
      imageUrl: resolveImageUrl(a.find("img").first()),
      contentRating:
        genres && ADULT_GENRE_REGEX.test(genres) ? ContentRating.ADULT : ContentRating.EVERYONE,
      genres,
      reads: stats[0] || undefined,
      rating: stats.length > 1 ? ratingValue(stats[stats.length - 1]) : undefined,
    });
  });

  return items;
}

// Carousel subtitle for a ranked item: "★ 8.9 · 18,972 reads", falling back to
// whichever stat is present, then the genre line.
export function topMangaSubtitle(item: TopMangaItem): string | undefined {
  const parts: string[] = [];
  if (item.rating) parts.push(`★ ${item.rating}`);
  if (item.reads) parts.push(`${item.reads} reads`);
  if (parts.length > 0) return parts.join(" · ");
  return item.genres || undefined;
}

// =============================== Home sections ===============================
// The home page stacks every curated rail (Most Popular, Top 10 Rising,
// Trending by Platform, More Trending, Latest, Fan Favorites …) in a single
// document, each introduced by an <h2 data-flux-heading> with no enclosing
// <section> wrapper. Slice the markup between one heading and the next so each
// rail can be parsed independently with parseMangaCards.
const SECTION_HEADING_REGEX = /data-flux-heading>\s*([^<]+?)\s*<\/h2>/gi;

export function sliceSectionHtml(html: string, heading: string): string | undefined {
  const wanted = heading.toLowerCase();
  const headings = [...html.matchAll(SECTION_HEADING_REGEX)];
  for (let i = 0; i < headings.length; i++) {
    if (headings[i][1].trim().toLowerCase() === wanted) {
      const start = headings[i].index ?? 0;
      const end = headings[i + 1]?.index ?? html.length;
      return html.slice(start, end);
    }
  }
  return undefined;
}

export function hasNextPage($: CheerioAPI): boolean {
  let found = false;
  $("[wire\\:click*='nextPage']").each((_, el) => {
    if ($(el).attr("disabled") === undefined) found = true;
  });
  return found;
}

function parseStatus($: CheerioAPI): string {
  const text = (
    $("span:has(> span.size-1\\.5)").first().text() ||
    $("span.inline-flex")
      .filter((_, el) => /Completed|Ongoing|Hiatus|Cancelled/i.test($(el).text()))
      .first()
      .text()
  )
    .toLowerCase()
    .trim();

  if (text.includes("ongoing") || text.includes("releasing")) return "Ongoing";
  if (text.includes("completed")) return "Completed";
  if (text.includes("hiatus")) return "Hiatus";
  if (text.includes("cancelled") || text.includes("dropped")) return "Cancelled";
  return "Unknown";
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
  const title = ($("h1").first().text() || $("[data-flux-heading]").first().text()).trim();

  const thumbnailUrl = resolveImageUrl(
    $(".w-32 > picture:nth-child(1) > img:nth-child(3)").first(),
  );

  const infoSection = $("div.flex.flex-col.md\\:flex-row").first();

  const authors: string[] = [];
  infoSection.find("a[href*='/author/']").each((_, el) => {
    const name = $(el).text().trim();
    if (name) authors.push(name);
  });

  const genres: string[] = [];
  $("div.flex.items-center.gap-2.justify-center.mb-2 div[data-flux-badge]").each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (TYPE_BADGES.has(text)) genres.push(text.charAt(0).toUpperCase() + text.slice(1));
  });
  infoSection.find("a[href*='/genre/']").each((_, el) => {
    const name = $(el).text().trim();
    if (name) genres.push(name);
  });

  let rating = 0;
  $("span.text-xs").each((_, el) => {
    if (rating) return;
    const match = $(el)
      .text()
      .trim()
      .match(/^(\d+\.\d+)/);
    if (match) rating = parseFloat(match[1]) / 10;
  });

  const synopsis = $("p.leading-relaxed").first().text().trim();

  const isAdult = $("span:contains('18+')").length > 0;

  const tagGroups: TagSection[] = [];
  if (genres.length > 0) {
    tagGroups.push({
      id: "genres",
      title: "Genres",
      tags: genres.map((g) => ({ id: GENRE_ID_BY_TITLE.get(g.toLowerCase()) ?? g, title: g })),
    });
  }

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl,
      synopsis,
      rating,
      contentRating: isAdult ? ContentRating.ADULT : ContentRating.EVERYONE,
      status: parseStatus($),
      tagGroups,
      author: authors.join(", ") || undefined,
      shareUrl: `${DOMAIN}/manga/${mangaId}`,
    },
  };
}

function splitDetails(text: string): string[] {
  return text
    .replace(/ - /g, " · ")
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function detailsLanguage(details: string[]): string {
  const known = details.find((d) => LANG_CODE_BY_BADGE.has(d.toUpperCase()));
  if (known) return known.toUpperCase();
  return "";
}

function detailsDate(details: string[]): string {
  return (
    details.find((d) => {
      const lower = d.toLowerCase();
      return lower.includes("ago") || lower === "today" || lower === "yesterday";
    }) ?? ""
  );
}

export function parseChapterDate(value: string): Date {
  const date = value.toLowerCase().trim();
  const now = new Date();
  if (!date) return now;
  if (date.includes("today")) return now;
  if (date.includes("yesterday")) {
    now.setDate(now.getDate() - 1);
    return now;
  }

  const match = date.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return now;

  const value2 = parseInt(match[1], 10);
  switch (match[2]) {
    case "minute":
      now.setMinutes(now.getMinutes() - value2);
      break;
    case "hour":
      now.setHours(now.getHours() - value2);
      break;
    case "day":
      now.setDate(now.getDate() - value2);
      break;
    case "week":
      now.setDate(now.getDate() - value2 * 7);
      break;
    case "month":
      now.setMonth(now.getMonth() - value2);
      break;
    case "year":
      now.setFullYear(now.getFullYear() - value2);
      break;
  }
  return now;
}

function makeChapter(
  sourceManga: SourceManga,
  href: string,
  numberText: string,
  badge: string,
  dateStr: string,
): Chapter | undefined {
  const url = chapterIdFromHref(href);
  if (!url || url === "/") return undefined;

  const numMatch = numberText.match(CHAPTER_NUMBER_REGEX);
  const parsedNum = numMatch ? parseFloat(numMatch[1]) : 0;
  // Coerce unparseable numbers to 0 (matching the reference's toFloatOrNull ?: 0f)
  // so a stray heading can't poison the chapNum sort comparator with NaN.
  const chapNum = Number.isFinite(parsedNum) ? parsedNum : 0;
  const langCode = LANG_CODE_BY_BADGE.get(badge.toUpperCase()) ?? "en";

  return {
    chapterId: url,
    sourceManga,
    chapNum,
    langCode,
    title: `Chapter ${numberText}`,
    publishDate: parseChapterDate(dateStr),
  };
}

// The site is English-first but some series carry multi-language chapter
// variants and there is no site-side language filter, so surface every chapter
// and tag each with its own detected language for the app to group on.
export function parseChapters($: CheerioAPI, sourceManga: SourceManga): Chapter[] {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  const push = (chapter: Chapter | undefined): void => {
    if (!chapter || seen.has(chapter.chapterId)) return;
    seen.add(chapter.chapterId);
    chapters.push(chapter);
  };

  // Structure 1: direct chapter links.
  $("a[wire\\:key^='ch-']").each((_, el) => {
    const link = $(el);
    const number =
      link.find("div[data-flux-heading]").first().text().replace("Chapter ", "").trim() ||
      link.find("div.w-10").first().text().trim();
    if (!number) return;

    const href = link.attr("href") ?? "";
    const details = splitDetails(link.find("p[data-flux-text]").first().text());

    push(makeChapter(sourceManga, href, number, detailsLanguage(details), detailsDate(details)));
  });

  // Structure 2: dropdown menus (per-language chapter variants).
  $("ui-dropdown[wire\\:key^='ch-']").each((_, el) => {
    const dropdown = $(el);
    const number =
      dropdown.find("div[data-flux-heading]").first().text().replace("Chapter ", "").trim() ||
      dropdown.find("button div.w-10").first().text().trim();
    if (!number) return;

    const details = splitDetails(dropdown.find("p[data-flux-text]").first().text());
    const dateStr = detailsDate(details);

    dropdown.find("ui-menu a[data-flux-menu-item]").each((_, link) => {
      const menuItem = $(link);
      const href = menuItem.attr("href") ?? "";
      const badge = (
        menuItem.find("div[data-flux-badge]").first().text() || menuItem.text()
      ).trim();

      push(makeChapter(sourceManga, href, number, badge, dateStr));
    });
  });

  return chapters;
}

export function extractReaderToken(body: string): string {
  return READER_TOKEN_REGEX.exec(body)?.[1] ?? "";
}

export function countPages(body: string): number {
  const matches = body.match(PAGE_ORDER_REGEX);
  return matches ? matches.length : 0;
}

export function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Failed to parse ${context}`, { cause: error });
  }
}
