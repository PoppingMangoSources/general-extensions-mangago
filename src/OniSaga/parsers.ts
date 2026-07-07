/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, type Chapter, type SourceManga, type TagSection } from "@paperback/types";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import { type Element } from "domhandler";

import { DOMAIN, LANGUAGES } from "./models";
import { chapterIdFromHref, getGenres, mangaIdFromHref } from "./utils/helpers";

const READER_TOKEN_REGEX = /readerToken["']?\s*:\s*["']([^"']+)["']/;
const TOTAL_PAGES_REGEX = /totalPages["']?\s*:\s*(\d+)/;
const PAGE_ORDER_REGEX = /["']?order["']?\s*:\s*(\d+)/g;
const CHAPTER_NUMBER_REGEX = /(\d+(?:\.\d+)?)/;

const TYPE_BADGES = new Set(["manga", "manhwa", "manhua", "shounen", "seinen", "shoujo", "josei"]);

const LANG_CODE_BY_BADGE = new Map(LANGUAGES.map((l) => [l.badge.toUpperCase(), l.langCode]));

// First recognized language badge inside a free-text label (e.g. the "FR" in
// "FR Unknown group 10p"); returns the original text when none is found.
function firstKnownBadge(text: string): string {
  for (const token of text.split(/\s+/)) {
    if (LANG_CODE_BY_BADGE.has(token.toUpperCase())) return token;
  }
  return text;
}

// Paperback rejects tag ids with characters outside its allowed set
// (alphanumeric plus ._-@()[]%?#+=/&:). Genre titles can carry spaces
// ("Inexperienced in Love"), so collapse any disallowed run to a single hyphen
// — a valid, stable id — for genres missing from the numeric filter list.
function slugifyTagId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

function resolveUrl(src: string): string {
  if (!src) return "";
  if (src.startsWith("http")) return src;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${DOMAIN}${src}`;
  return `${DOMAIN}/${src}`;
}

// Largest URL from a srcset ("a 150w, b 300w, c 450w" -> c).
function lastSrcsetUrl(srcset: string): string {
  const urls = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
  return urls[urls.length - 1] ?? "";
}

function resolveImageUrl($el: Cheerio<Element>): string {
  const direct = $el.attr("data-src") || $el.attr("data-lazy-src") || $el.attr("src") || "";
  if (direct && !direct.startsWith("data:")) return resolveUrl(direct);

  // Lazy cards keep the real image in a srcset (on the <img> or a <picture>
  // <source>); prefer the webp source.
  const srcset =
    $el.attr("srcset") ||
    $el.attr("data-srcset") ||
    $el.parent().find('source[type="image/webp"]').first().attr("srcset") ||
    $el.parent().find("source[srcset]").first().attr("srcset") ||
    "";
  const fromSet = lastSrcsetUrl(srcset);
  return fromSet ? resolveUrl(fromSet) : "";
}

export interface MangaCard {
  mangaId: string;
  title: string;
  imageUrl: string;
  contentRating: ContentRating;
  genres?: string;
  views?: string;
}

// Card view count ("20,558 views"); ratings only live on the top-manga page.
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
    // Paperback throws "Invalid URL" on an empty imageUrl, so skip imageless
    // cards rather than emit a broken discover item.
    if (!imageUrl) return;

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

// One browse/search page of cards; a filtered browse Livewire response can be
// 15 MB (the whole catalog), so we never parse more than this many.
export const CARD_PARSE_CAP = 100;

// Parse browse/search cards straight off the Livewire HTML string. A filtered
// browse response can render the entire catalog (tens of MB); `cheerio.load`-ing
// all of it freezes the device, so instead find each `div.relative.group` card
// wrapper by scanning the text, then cheerio-parse only that one small slice —
// and stop after a page's worth. Bounds the work at ~100 tiny parses regardless
// of how large the response is.
export function parseMangaCardsFromHtml(html: string, showNsfw: boolean): MangaCard[] {
  const starts: number[] = [];
  const openDivRegex = /<div\b[^>]*?\bclass="([^"]*)"/g;
  for (const match of html.matchAll(openDivRegex)) {
    const classes = match[1].split(/\s+/);
    if (classes.includes("relative") && classes.includes("group")) {
      starts.push(match.index);
      if (starts.length > CARD_PARSE_CAP) break;
    }
  }

  const cards: MangaCard[] = [];
  for (let i = 0; i < starts.length && cards.length < CARD_PARSE_CAP; i++) {
    const slice = html.slice(starts[i], starts[i + 1] ?? html.length);
    const parsed = parseMangaCards(load(slice), showNsfw);
    if (parsed[0]) cards.push(parsed[0]);
  }
  return cards;
}

// Fallback for component markup that doesn't use the browse card layout (the
// /trending Top 10 re-renders as a compact ranked list, not poster cards):
// any manga anchor wrapping a poster image becomes a card.
export function parseAnchorCards($: CheerioAPI, showNsfw: boolean): MangaCard[] {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();

  $("a[href*='/manga/']").each((_, el) => {
    const a = $(el);
    const img = a.find("img").first();
    if (img.length === 0) return;
    const mangaId = mangaIdFromHref(a.attr("href") ?? "");
    if (!mangaId || seen.has(mangaId)) return;

    const title = (a.attr("title") || a.attr("aria-label") || img.attr("alt") || a.text())
      .replace(/\s*(?:manga\s*)?cover\s*$/i, "")
      .trim();
    const imageUrl = resolveImageUrl(img);
    if (!title || !imageUrl) return;

    // In the ranked-list layout the 18+ marker sits beside the anchor in the
    // row, not inside it, so check the containing row too before trusting it.
    const row = a.closest("li");
    const scope = (row.length > 0 ? row : a.parent()) as Cheerio<Element>;
    const isAdult = hasAdultMarker(a) || hasAdultMarker(scope);
    if (isAdult && !showNsfw) return;

    seen.add(mangaId);
    cards.push({
      mangaId,
      title,
      imageUrl,
      contentRating: isAdult ? ContentRating.ADULT : ContentRating.EVERYONE,
    });
  });

  return cards;
}

// ============================= Top-manga ranking =============================
// /top-manga rows carry both the read count and ★ rating that /browse lacks.
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

// The 18+ overlay/badge the site stamps on adult posters.
function hasAdultMarker(el: Cheerio<Element>): boolean {
  return el.find("span:contains('18+')").length > 0;
}

export function parseTopManga($: CheerioAPI, showNsfw: boolean): TopMangaItem[] {
  const items: TopMangaItem[] = [];
  const seen = new Set<string>();

  const add = (item: TopMangaItem | undefined): void => {
    if (!item || !item.mangaId || !item.title || !item.imageUrl || seen.has(item.mangaId)) return;
    if (item.contentRating === ContentRating.ADULT && !showNsfw) return;
    seen.add(item.mangaId);
    items.push(item);
  };

  // Podium (ranks 1-3): poster anchors; title from the image alt, reads from a
  // "N reads" line. The rank-4+ rows live in an <ol> inside the same section,
  // so skip those here, and order by the displayed rank — the page renders the
  // podium visually as 2-1-3 with the winner centred.
  const podium: { rank: number; item: TopMangaItem }[] = [];
  $("section a[href*='/manga/']").each((_, el) => {
    const a = $(el);
    if (a.closest("ol").length > 0) return;
    const img = a.find("img").first();
    if (img.length === 0) return;
    const readsMatch = a.text().match(/([\d,]+)\s*reads/i);
    if (!readsMatch) return;

    podium.push({
      rank: parseInt(a.text().match(/\b0?(\d)\b/)?.[1] ?? "9", 10),
      item: {
        mangaId: mangaIdFromHref(a.attr("href") ?? ""),
        title: (img.attr("alt") ?? "").replace(/\s*cover\s*$/i, "").trim(),
        imageUrl: resolveImageUrl(img),
        contentRating: hasAdultMarker(a) ? ContentRating.ADULT : ContentRating.EVERYONE,
        reads: readsMatch[1],
      },
    });
  });
  podium.sort((a, b) => a.rank - b.rank).forEach((entry) => add(entry.item));

  // Ranked list (rank 4+): each <li> anchor has title, genres, and a stat block
  // (reads then ★ rating).
  $("ol li a[href*='/manga/']").each((_, el) => {
    const a = $(el);
    const genres = cleanGenreLine(a.find('[class*="text-accent/45"]').first().text()) || undefined;
    const stats = a
      .find('[class*="text-right"]')
      .first()
      .children("span")
      .map((_, s) => $(s).text().trim())
      .get();
    const adult = hasAdultMarker(a) || (genres !== undefined && ADULT_GENRE_REGEX.test(genres));

    add({
      mangaId: mangaIdFromHref(a.attr("href") ?? ""),
      title: a.find('[class*="line-clamp-1"]').first().text().trim(),
      imageUrl: resolveImageUrl(a.find("img").first()),
      contentRating: adult ? ContentRating.ADULT : ContentRating.EVERYONE,
      genres,
      reads: stats[0] || undefined,
      rating: stats.length > 1 ? ratingValue(stats[stats.length - 1]) : undefined,
    });
  });

  return items;
}

// Carousel subtitle: "★ 8.9 · 18,972 reads", or whichever stat/genre is present.
export function topMangaSubtitle(item: TopMangaItem): string | undefined {
  const parts: string[] = [];
  if (item.rating) parts.push(`★ ${item.rating}`);
  if (item.reads) parts.push(`${item.reads} reads`);
  if (parts.length > 0) return parts.join(" · ");
  return item.genres || undefined;
}

// =============================== Home sections ===============================
// Outer HTML of the Livewire component whose wire:snapshot names it, so its
// cards can be parsed. Empty when the page lacks the component.
export function componentHtmlByName($: CheerioAPI, componentName: string): string {
  let html = "";
  $("[wire\\:snapshot]").each((_, el) => {
    if (html) return;
    if (($(el).attr("wire:snapshot") ?? "").includes(componentName)) {
      html = $.html(el);
    }
  });
  return html;
}

export function hasNextPage($: CheerioAPI): boolean {
  let found = false;
  $("[wire\\:click*='nextPage']").each((_, el) => {
    if ($(el).attr("disabled") === undefined) found = true;
  });
  return found;
}

// The /home page server-renders every discover rail inline — no 10MB+ /browse
// document. Slice one rail out by its section heading, stopping at the next
// rail's heading, a Livewire island (`wire:snapshot`) or a flux section heading,
// then parse the cards from that region of the already-fetched document. Not
// every rail heading is a `data-flux-heading` (the SSR "Latest Mangas" grid is
// plain), so the sibling headings are explicit boundaries too — otherwise the
// "Most Popular" carousel would swallow the "Latest Mangas" grid that follows it.
const HOME_RAIL_HEADINGS = ["Most Popular", "Latest Mangas", "Fan Favorites", "Top Rated"];

export function parseHomeRail(html: string, heading: string, showNsfw: boolean): MangaCard[] {
  const start = html.indexOf(heading);
  if (start < 0) return [];
  const after = html.slice(start + heading.length);

  let end = after.length;
  const boundaries = [
    ...HOME_RAIL_HEADINGS.filter((h) => h !== heading),
    "wire:snapshot",
    "data-flux-heading",
  ];
  for (const marker of boundaries) {
    const at = after.indexOf(marker);
    if (at >= 0 && at < end) end = at;
  }

  return parseMangaCardsFromHtml(after.slice(0, end), showNsfw);
}

// String twin of hasNextPage for the multi-MB browse response we never fully
// cheerio-load: an enabled `wire:click="...nextPage..."` control means there's
// another page.
export function hasNextPageFromHtml(html: string): boolean {
  const regex = /<[^>]*\bwire:click="[^"]*nextPage[^"]*"[^>]*>/g;
  for (const match of html.matchAll(regex)) {
    if (!/\bdisabled\b/.test(match[0])) return true;
  }
  return false;
}

function parseStatus($: CheerioAPI): string {
  const text = (
    $("span:has(> span.size-1\\.5)").first().text() ||
    $("span.inline-flex")
      .filter((_, el) => /Completed|Ongoing|Releasing|Hiatus|Cancelled/i.test($(el).text()))
      .first()
      .text()
  )
    .toLowerCase()
    .trim();

  // Releasing is a distinct site status (it has its own Status filter), so keep
  // it separate from Ongoing rather than collapsing the two.
  if (text.includes("releasing")) return "Releasing";
  if (text.includes("ongoing")) return "Ongoing";
  if (text.includes("completed")) return "Completed";
  if (text.includes("hiatus")) return "Hiatus";
  if (text.includes("cancelled") || text.includes("dropped")) return "Cancelled";
  return "Unknown";
}

export function parseMangaDetails($: CheerioAPI, mangaId: string): SourceManga {
  const title = ($("h1").first().text() || $("[data-flux-heading]").first().text()).trim();

  // The poster markup varies between titles, so try the poster block loosely
  // then fall back to the page's og:image/twitter:image. An empty thumbnailUrl
  // makes Paperback throw "Invalid URL", so this must always resolve something.
  const thumbnailUrl =
    resolveImageUrl($(".w-32 picture img").first()) ||
    resolveImageUrl($(".w-32 img").first()) ||
    resolveUrl($('meta[property="og:image"]').attr("content")?.trim() ?? "") ||
    resolveUrl($('meta[name="twitter:image"]').attr("content")?.trim() ?? "");

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

  // Normalize by the displayed denominator ("8.6/10", "4.3/5"); default /10.
  // Scoped to the details header: an unrated title must not inherit a score
  // from a rated card in the Recommended rail further down the page.
  let rating = 0;
  infoSection.find("span.text-xs").each((_, el) => {
    if (rating) return;
    const match = $(el)
      .text()
      .trim()
      .match(/^(\d+\.\d+)(?:\s*\/\s*(\d+))?/);
    if (!match) return;
    const scale = match[2] ? parseInt(match[2], 10) : 10;
    if (scale > 0) rating = Math.min(parseFloat(match[1]) / scale, 1);
  });

  const synopsis = $("p.leading-relaxed").first().text().trim();

  // Scope to the details header (info block + poster) so an 18+ card in a
  // recommendations rail further down the page can't mislabel this title.
  const isAdult = hasAdultMarker(infoSection) || hasAdultMarker($(".w-32").first());

  const tagGroups: TagSection[] = [];
  if (genres.length > 0) {
    // Prefer the site's numeric filter id (so tapping the tag searches that
    // genre); fall back to a slugified id for anything not in the list, so an
    // unknown genre renders instead of crashing the details page.
    const idByTitle = new Map(getGenres().map((g) => [g.title.toLowerCase(), g.id]));
    tagGroups.push({
      id: "genres",
      title: "Genres",
      tags: genres.map((g) => ({
        id: idByTitle.get(g.toLowerCase()) ?? slugifyTagId(g),
        title: g,
      })),
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
  // Coerce unparseable numbers to 0 so a stray heading can't NaN the sort.
  const chapNum = Number.isFinite(parsedNum) ? parsedNum : 0;
  const langCode = LANG_CODE_BY_BADGE.get(badge.toUpperCase()) ?? "en";

  return {
    chapterId: url,
    sourceManga,
    chapNum,
    volume: 0,
    langCode,
    title: `Chapter ${numberText}`,
    publishDate: parseChapterDate(dateStr),
  };
}

// Surface every chapter, tagging each with its detected language (some series
// have multi-language variants and the site has no language filter).
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
      // Variants like "FR Unknown group 10p" don't always wrap the badge in its
      // own element; when the badge div is absent, pick the first recognized
      // language token out of the label so non-English variants aren't read as EN.
      const badge =
        menuItem.find("div[data-flux-badge]").first().text().trim() ||
        firstKnownBadge(menuItem.text().trim());

      push(makeChapter(sourceManga, href, number, badge, dateStr));
    });
  });

  return chapters;
}

export function extractReaderToken(body: string): string {
  return READER_TOKEN_REGEX.exec(body)?.[1] ?? "";
}

export function countPages(body: string): number {
  // The reader page embeds an authoritative `totalPages: N`; prefer it over
  // counting `order:` occurrences (which the page may repeat for spreads).
  const total = TOTAL_PAGES_REGEX.exec(body);
  if (total?.[1]) {
    const count = parseInt(total[1], 10);
    if (count > 0) return count;
  }
  const matches = body.match(PAGE_ORDER_REGEX);
  return matches ? matches.length : 0;
}

// The reader page embeds the page list as `[{"order":0,...},...]`, and the
// site's own reader requests pages by their `order` field — orders are
// authoritative and can have gaps (re-imports), so sequential 0..N-1 URLs
// would miss or 404 on such chapters. Sorted, de-duplicated; [] if absent.
export function extractPageOrders(body: string): number[] {
  const orders = new Set<number>();
  for (const match of body.matchAll(PAGE_ORDER_REGEX)) {
    orders.add(parseInt(match[1], 10));
  }
  return [...orders].sort((a, b) => a - b);
}
