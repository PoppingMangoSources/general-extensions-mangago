/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type FeaturedCarouselItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";

import { DOMAIN, GENRES, LANGUAGES, type LivewireState } from "./models";

export const straightenQuotes = (value: string): string =>
  value.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');

export const mangaIdFromHref = (href: string): string => {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  return (path.split("/manga/")[1] ?? "").split(/[?#]/)[0].replace(/^\/+|\/+$/g, "");
};

const chapterIdFromHref = (href: string): string => {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  return path.startsWith("/") ? path : `/${path}`;
};

export const normalizeReleaseDate = (value: string | undefined, isEnd: boolean): string | null => {
  const raw = value?.trim() ?? "";
  if (/^\d{4}$/.test(raw)) return isEnd ? `${raw}-12-31` : `${raw}-01-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
};

export const parseJson = <T>(raw: string, context: string): T => {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Failed to parse ${context}`, { cause: error });
  }
};

export const discoverSectionType = (id: string): DiscoverSectionType => {
  switch (id) {
    case "top_manga":
      return DiscoverSectionType.featured;
    case "highest_rated":
      return DiscoverSectionType.prominentCarousel;
    default:
      return DiscoverSectionType.simpleCarousel;
  }
};

export const topMangaInfoItems = (item: TopMangaItem): FeaturedCarouselItem["infoItems"] => {
  const pills: { symbol: string; text: string }[] = [];
  if (item.rating) pills.push({ symbol: "star.fill", text: item.rating });
  if (item.reads) pills.push({ symbol: "flame.fill", text: item.reads });
  if (pills.length === 0) return undefined;
  return (
    pills.length === 1 ? [pills[0]] : [pills[0], pills[1]]
  ) as FeaturedCarouselItem["infoItems"];
};

const READER_TOKEN_REGEX = /readerToken["']?\s*:\s*["']([^"']+)["']/;
const TOTAL_PAGES_REGEX = /totalPages["']?\s*:\s*(\d+)/;
const PAGE_ORDER_REGEX = /(?<![\w-])["']order["']\s*:\s*(\d+)/g;
const CHAPTER_NUMBER_REGEX = /(\d+(?:\.\d+)?)/;

const TYPE_BADGES = new Set(["manga", "manhwa", "manhua", "shounen", "seinen", "shoujo", "josei"]);

const LANG_CODE_BY_BADGE = new Map(LANGUAGES.map((l) => [l.badge.toUpperCase(), l.langCode]));

const firstKnownBadge = (text: string): string => {
  for (const token of text.split(/\s+/)) {
    if (LANG_CODE_BY_BADGE.has(token.toUpperCase())) return token;
  }
  return text;
};

const slugifyTagId = (value: string): string => {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
};

const resolveUrl = (src: string): string => {
  if (!src) return "";
  if (src.startsWith("http")) return src;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${DOMAIN}${src}`;
  return `${DOMAIN}/${src}`;
};

const lastSrcsetUrl = (srcset: string): string => {
  const urls = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
  return urls[urls.length - 1] ?? "";
};

const resolveImageUrl = ($el: Cheerio<AnyNode>): string => {
  const direct = $el.attr("data-src") || $el.attr("data-lazy-src") || $el.attr("src") || "";
  if (direct && !direct.startsWith("data:")) return resolveUrl(direct);

  const srcset =
    $el.attr("srcset") ||
    $el.attr("data-srcset") ||
    $el.parent().find('source[type="image/webp"]').first().attr("srcset") ||
    $el.parent().find("source[srcset]").first().attr("srcset") ||
    "";
  const fromSet = lastSrcsetUrl(srcset);
  return fromSet ? resolveUrl(fromSet) : "";
};

export interface MangaCard {
  mangaId: string;
  title: string;
  imageUrl: string;
  contentRating: ContentRating;
  genres?: string;
  views?: string;
}

const extractCardViews = (text: string): string | undefined => {
  const match = text.match(/(\d[\d.,]*\s*[KMB]?)\s*(?:views|reads)\b/i);
  return match ? match[1].trim() : undefined;
};

export const buildStatSubtitle = (card: MangaCard): string | undefined => {
  if (card.views) return `${card.views} views`;
  return card.genres || undefined;
};

export const parseMangaCards = ($: CheerioAPI, showNsfw: boolean): MangaCard[] => {
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
};

const CARD_PARSE_CAP = 100;

export const parseMangaCardsFromHtml = (
  html: string,
  showNsfw: boolean,
): { cards: MangaCard[]; rawCount: number; truncated: boolean } => {
  const starts: number[] = [];
  const openDivRegex = /<div\b[^>]*?\bclass="([^"]*)"/g;
  for (const match of html.matchAll(openDivRegex)) {
    const classes = match[1].split(/\s+/);
    if (classes.includes("relative") && classes.includes("group")) {
      starts.push(match.index);
      if (starts.length > CARD_PARSE_CAP) break;
    }
  }
  const truncated = starts.length > CARD_PARSE_CAP;

  const cards: MangaCard[] = [];
  for (let i = 0; i < starts.length && cards.length < CARD_PARSE_CAP; i++) {
    const slice = html.slice(starts[i], starts[i + 1] ?? html.length);
    const parsed = parseMangaCards(load(slice), showNsfw);
    if (parsed[0]) cards.push(parsed[0]);
  }
  return { cards, rawCount: starts.length, truncated };
};

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

const cleanGenreLine = (text: string): string => {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*[·/]\s*/g, " · ")
    .trim();
};

const ratingValue = (text: string): string | undefined => {
  return text.match(/\d+(?:\.\d+)?/)?.[0];
};

const hasAdultMarker = (el: Cheerio<AnyNode>): boolean => {
  return el.find("span:contains('18+')").length > 0;
};

export const parseTopManga = ($: CheerioAPI, showNsfw: boolean): TopMangaItem[] => {
  const items: TopMangaItem[] = [];
  const seen = new Set<string>();

  const add = (item: TopMangaItem | undefined): void => {
    if (!item || !item.mangaId || !item.title || !item.imageUrl || seen.has(item.mangaId)) return;
    if (item.contentRating === ContentRating.ADULT && !showNsfw) return;
    seen.add(item.mangaId);
    items.push(item);
  };

  const podium: { rank: number; item: TopMangaItem }[] = [];
  $("section a[href*='/manga/']").each((_, el) => {
    const a = $(el);
    if (a.closest("ol").length > 0) return;
    const img = a.find("img").first();
    if (img.length === 0) return;
    const readsMatch = a.text().match(/([\d,]+)\s*reads/i);
    if (!readsMatch) return;

    podium.push({
      rank: parseInt(a.text().match(/(?<![\w,])0?(\d)(?![\w,])/)?.[1] ?? "9", 10),
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
};

export const topMangaSubtitle = (item: TopMangaItem): string | undefined => {
  const parts: string[] = [];
  if (item.rating) parts.push(`★ ${item.rating}`);
  if (item.reads) parts.push(`${item.reads} reads`);
  if (parts.length > 0) return parts.join(" · ");
  return item.genres || undefined;
};

export const componentHtmlByName = ($: CheerioAPI, componentName: string): string => {
  let html = "";
  $("[wire\\:snapshot]").each((_, el) => {
    if (html) return;
    if (($(el).attr("wire:snapshot") ?? "").includes(componentName)) {
      html = $.html(el);
    }
  });
  return html;
};

export const extractLivewireState = (
  $: CheerioAPI,
  componentName: string,
): LivewireState | undefined => {
  const token =
    $("meta[name=csrf-token]").attr("content")?.trim() ||
    $("input[name=_token]").attr("value")?.trim();
  if (!token) return undefined;

  let snapshot: string | undefined;
  $("[wire\\:snapshot]").each((_, el) => {
    if (snapshot) return;
    const value = $(el).attr("wire:snapshot");
    if (value && value.includes(componentName)) {
      snapshot = value;
    }
  });

  if (!snapshot) return undefined;
  return { token, snapshot };
};

const decodeEntities = (value: string): string => {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
};

export const extractLivewireStateFromHtml = (
  html: string,
  componentName: string,
): LivewireState | undefined => {
  const token =
    html.match(/<meta name="csrf-token" content="([^"]+)"/)?.[1] ??
    html.match(/name="_token"\s+value="([^"]+)"/)?.[1];
  if (!token) return undefined;

  const snapshotRegex = /wire:snapshot="([^"]+)"/g;
  for (const match of html.matchAll(snapshotRegex)) {
    if (match[1].includes(componentName)) {
      return { token, snapshot: decodeEntities(match[1]) };
    }
  }
  return undefined;
};

const HOME_RAIL_HEADINGS = ["Most Popular", "Latest Mangas", "Fan Favorites", "Top Rated"];

export const parseHomeRail = (html: string, heading: string, showNsfw: boolean): MangaCard[] => {
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

  return parseMangaCardsFromHtml(after.slice(0, end), showNsfw).cards;
};

export const hasNextPageFromHtml = (html: string): boolean => {
  const regex = /<[^>]*\bwire:click="[^"]*nextPage[^"]*"[^>]*>/g;
  for (const match of html.matchAll(regex)) {
    if (!/\sdisabled(?=[\s=>/])/.test(match[0])) return true;
  }
  return false;
};

const parseStatus = ($: CheerioAPI): string => {
  const text = (
    $("span:has(> span.size-1\\.5)").first().text() ||
    $("span.inline-flex")
      .filter((_, el) => /Completed|Ongoing|Releasing|Hiatus|Cancelled/i.test($(el).text()))
      .first()
      .text()
  )
    .toLowerCase()
    .trim();

  if (text.includes("releasing")) return "Releasing";
  if (text.includes("ongoing")) return "Ongoing";
  if (text.includes("completed")) return "Completed";
  if (text.includes("hiatus")) return "Hiatus";
  if (text.includes("cancelled") || text.includes("dropped")) return "Cancelled";
  return "Unknown";
};

export const parseMangaDetails = ($: CheerioAPI, mangaId: string): SourceManga => {
  const title = ($("h1").first().text() || $("[data-flux-heading]").first().text()).trim();

  const thumbnailUrl =
    resolveImageUrl($(".w-32 picture img").first()) ||
    resolveImageUrl($(".w-32 img").first()) ||
    resolveUrl($('meta[property="og:image"]').attr("content")?.trim() ?? "") ||
    resolveUrl($('meta[name="twitter:image"]').attr("content")?.trim() ?? "") ||
    `${DOMAIN}/favicon.ico`;

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

  const isAdult = hasAdultMarker(infoSection) || hasAdultMarker($(".w-32").first());

  const tagGroups: TagSection[] = [];
  if (genres.length > 0) {
    const idByTitle = new Map(GENRES.map((genre) => [genre.title.toLowerCase(), genre.id]));
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
};

const splitDetails = (text: string): string[] => {
  return text
    .replace(/ - /g, " · ")
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const detailsLanguage = (details: string[]): string => {
  const known = details.find((d) => LANG_CODE_BY_BADGE.has(d.toUpperCase()));
  if (known) return known.toUpperCase();
  return "";
};

const detailsDate = (details: string[]): string => {
  return (
    details.find((d) => {
      const lower = d.toLowerCase();
      return (
        lower.includes("ago") ||
        lower === "today" ||
        lower === "yesterday" ||
        /\b(19|20)\d{2}\b/.test(d)
      );
    }) ?? ""
  );
};

const parseChapterDate = (value: string): Date => {
  const date = value.toLowerCase().trim();
  const now = new Date();
  if (!date) return now;
  if (date.includes("today")) return now;
  if (date.includes("yesterday")) {
    now.setDate(now.getDate() - 1);
    return now;
  }

  const match = date.match(/(\d+|an?)\s+(minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) {
    const absolute = new Date(value.trim());
    return Number.isNaN(absolute.getTime()) ? now : absolute;
  }

  const value2 = /^\d/.test(match[1]) ? parseInt(match[1], 10) : 1;
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
};

const makeChapter = (
  sourceManga: SourceManga,
  href: string,
  numberText: string,
  badge: string,
  dateStr: string,
): Chapter | undefined => {
  const url = chapterIdFromHref(href);
  if (!url || url === "/") return undefined;

  const numMatch = numberText.match(CHAPTER_NUMBER_REGEX);
  const parsedNum = numMatch ? parseFloat(numMatch[1]) : 0;
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
};

export const parseChapters = ($: CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  const push = (chapter: Chapter | undefined): void => {
    if (!chapter || seen.has(chapter.chapterId)) return;
    seen.add(chapter.chapterId);
    chapters.push(chapter);
  };

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
      const badge =
        menuItem.find("div[data-flux-badge]").first().text().trim() ||
        firstKnownBadge(menuItem.text().trim());

      push(makeChapter(sourceManga, href, number, badge, dateStr));
    });
  });

  return chapters;
};

export const extractReaderToken = (body: string): string => {
  return READER_TOKEN_REGEX.exec(body)?.[1] ?? "";
};

export const countPages = (body: string): number => {
  const total = TOTAL_PAGES_REGEX.exec(body);
  if (total?.[1]) {
    const count = parseInt(total[1], 10);
    if (count > 0) return count;
  }
  const matches = body.match(PAGE_ORDER_REGEX);
  return matches ? matches.length : 0;
};

export const extractPageOrders = (body: string): number[] => {
  const orders = new Set<number>();
  for (const match of body.matchAll(PAGE_ORDER_REGEX)) {
    orders.add(parseInt(match[1], 10));
  }
  return [...orders].sort((a, b) => a - b);
};
