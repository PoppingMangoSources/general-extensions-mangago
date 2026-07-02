/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type FeaturedCarouselItem,
  type PagedResults,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  DOMAIN,
  type BrowseEntry,
  type ChapterContentResponse,
  type ChapterEntry,
  type FilterOptions,
  type LatestChapterEntry,
  type PopularItem,
  type SearchResultEntry,
} from "./models";

export function parseCarouselItems(jsonStr: string): PagedResults<DiscoverSectionItem> {
  const data = JSON.parse(jsonStr) as PopularItem[];
  const items: DiscoverSectionItem[] = [];

  for (const manga of data) {
    const mangaId = extractMangaSlug(manga.permalink);
    if (mangaId && manga.title) {
      items.push({
        mangaId,
        title: manga.title,
        subtitle: manga.manga_type || undefined,
        imageUrl: fixImageUrl(manga.cover),
        type: "simpleCarouselItem",
      });
    }
  }

  return { items, metadata: undefined };
}

export function parseFeaturedItems(
  jsonStr: string,
  limit: number,
): PagedResults<DiscoverSectionItem> {
  const data = JSON.parse(jsonStr) as BrowseEntry[];
  if (!Array.isArray(data)) return { items: [] };

  const items: DiscoverSectionItem[] = [];
  for (const entry of data.slice(0, limit)) {
    const mangaId = extractMangaSlug(entry.url);
    if (!mangaId || !entry.title) continue;

    const infoItems: { symbol: string; text: string }[] = [];
    if (parseFloat(entry.score) > 0) infoItems.push({ symbol: "star.fill", text: entry.score });
    if (entry.votes > 0)
      infoItems.push({ symbol: "person.2.fill", text: formatCount(entry.votes) });

    items.push({
      type: "featuredCarouselItem",
      mangaId,
      title: entry.title,
      imageUrl: fixImageUrl(entry.cover),
      supertitle: entry.type || undefined,
      // descriptions arrive with HTML entities (&#039; etc.)
      summary: entry.description ? cheerio.load(entry.description).text() : undefined,
      infoItems: infoItems.length ? (infoItems as FeaturedCarouselItem["infoItems"]) : undefined,
    });
  }

  return { items, metadata: undefined };
}

const formatCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n);

export function parseLatestUpdates(
  jsonStr: string,
  page: number,
): PagedResults<DiscoverSectionItem> {
  const response = JSON.parse(jsonStr) as { success: boolean; data: LatestChapterEntry[] };

  if (!response.success || !response.data) {
    return { items: [] };
  }

  const items: DiscoverSectionItem[] = [];

  for (const entry of response.data) {
    const mangaId = extractMangaSlug(entry.manga_permalink);
    const chapterId = extractChapterId(entry.last_3_chapters?.[0]?.link ?? "");

    if (mangaId && entry.title && chapterId) {
      items.push({
        mangaId,
        title: entry.title,
        chapterId,
        subtitle: entry.chapter || undefined,
        imageUrl: fixImageUrl(entry.cover),
        type: "chapterUpdatesCarouselItem",
      });
    }
  }

  return {
    items,
    metadata: items.length > 0 && page < 10 ? page + 1 : undefined,
  };
}

export function parseSearchResults(jsonStr: string): SearchResultItem[] {
  const data = JSON.parse(jsonStr) as SearchResultEntry[];
  if (!Array.isArray(data)) return [];

  const items: SearchResultItem[] = [];
  for (const entry of data) {
    const mangaId = entry.slug || extractMangaSlug(entry.permalink);
    if (mangaId && entry.title) {
      items.push({
        mangaId,
        title: entry.title,
        subtitle: entry.type || undefined,
        imageUrl: fixImageUrl(entry.thumbnail),
      });
    }
  }

  return items;
}

export function parseBrowseResults(jsonStr: string): SearchResultItem[] {
  const data = JSON.parse(jsonStr) as BrowseEntry[];
  if (!Array.isArray(data)) return []; // WP error envelope on failure

  const items: SearchResultItem[] = [];
  for (const entry of data) {
    const mangaId = extractMangaSlug(entry.url);
    if (mangaId && entry.title) {
      items.push({
        mangaId,
        title: entry.title,
        subtitle: entry.type || undefined,
        imageUrl: fixImageUrl(entry.cover),
      });
    }
  }

  return items;
}

export function parseFilterOptions(html: string): FilterOptions {
  const $ = cheerio.load(html);

  const grab = (selector: string): Tag[] =>
    $(selector)
      .toArray()
      .flatMap((el) => {
        const id = $(el).attr("data-value");
        if (!id) return []; // skip the "All ..." option
        // strip the trailing result count, e.g. "Action 830"
        const title = $(el).text().replace(/\s+/g, " ").trim().replace(/ \d+$/, "");
        return { id, title };
      });

  return {
    types: grab(".type-btn"),
    statuses: grab(".status-btn"),
    years: grab(".year-btn"),
    genres: grab(".genre-btn"),
  };
}

const ADULT_TAGS = ["adult", "erotica", "smut", "hentai", "pornographic"];
const MATURE_TAGS = ["mature", "ecchi"];

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim() || mangaId;

  // Cover, author, status and content type come from JSON-LD ("Book" = novel)
  let imageUrl = "";
  let author = "";
  let status: "ONGOING" | "COMPLETED" | "UNKNOWN" = "UNKNOWN";
  let contentType: "comic" | "novel" = "comic";
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const ld = JSON.parse($(el).html() ?? "") as {
        "@type"?: string;
        image?: string;
        author?: { name?: string };
        status?: string;
      };
      if (ld["@type"] !== "ComicSeries" && ld["@type"] !== "Book") return;
      if (ld["@type"] === "Book") contentType = "novel";
      if (ld.image) imageUrl = ld.image;
      if (ld.author?.name) author = ld.author.name;
      if (ld.status) {
        const s = ld.status.toLowerCase();
        if (s.includes("ongoing")) status = "ONGOING";
        else if (s.includes("complete")) status = "COMPLETED";
      }
    } catch {
      /* skip */
    }
  });
  if (!imageUrl) {
    imageUrl = $('img[alt^="Cover for"]').first().attr("src") ?? "";
  }

  const descEl = $("#description-content-tab");
  const paragraphs = descEl
    .find("p")
    .toArray()
    .map((p) => $(p).text().trim())
    .filter(Boolean);
  const description = paragraphs.join("\n") || descEl.text().trim() || "No description available.";

  // genre anchors appear twice (desktop + mobile blocks); dedupe on the href slug
  const tagMap = new Map<string, Tag>();
  $('a[href*="/tag/"]').each((_i, el) => {
    const id = $(el)
      .attr("href")
      ?.match(/\/tag\/([^/]+)/)?.[1];
    const tagTitle = $(el).text().trim();
    if (id && tagTitle) tagMap.set(id, { id, title: tagTitle });
  });
  const tags = [...tagMap.values()];

  const tagSections: TagSection[] = [];
  if (tags.length > 0) {
    tagSections.push({ id: "genres", title: "Genres", tags });
  }

  const contentRating = tags.some((t) => ADULT_TAGS.includes(t.id))
    ? ContentRating.ADULT
    : tags.some((t) => MATURE_TAGS.includes(t.id))
      ? ContentRating.MATURE
      : ContentRating.EVERYONE;

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl: fixImageUrl(imageUrl),
      synopsis: description,
      author: author || undefined,
      contentRating,
      contentType,
      status,
      tagGroups: tagSections,
    },
  };
}

export function extractMangaNumericId(html: string): string {
  return /data-manga-id="(\d+)"/.exec(html)?.[1] ?? "";
}

export function parseChapters(
  jsonStr: string,
  sourceManga: SourceManga,
): { chapters: Chapter[]; hasMore: boolean } {
  const response = JSON.parse(jsonStr) as {
    success: boolean;
    chapters: ChapterEntry[];
    has_more: boolean;
  };

  if (!response.success || !response.chapters) {
    return { chapters: [], hasMore: false };
  }

  return {
    chapters: response.chapters.map((entry) => ({
      chapterId: entry.id,
      sourceManga,
      langCode: entry.language || "en",
      chapNum: parseFloat(entry.chapter) || 0,
      title: entry.title && entry.title !== "N/A" ? entry.title.trim() : undefined,
      volume: 0, // Source does not provide volume information
      publishDate: parseRelativeDate(entry.date),
    })),
    hasMore: response.has_more === true,
  };
}

export function parseChapterDetails(
  jsonStr: string,
  chapterId: string,
  mangaId: string,
): ChapterDetails {
  const response = JSON.parse(jsonStr) as ChapterContentResponse;

  if (response.success && response.chapter_type === "text" && response.content) {
    return { id: chapterId, mangaId, type: "html", html: toXhtml(response.content) };
  }

  if (!response.success || !response.images || response.images.length === 0) {
    throw new Error(`No content found for chapter ${chapterId}.`);
  }

  return {
    id: chapterId,
    mangaId,
    pages: response.images.map((url) => fixImageUrl(url)),
  };
}

// Readium renders novel chapters as XHTML; a lenient HTML parse re-serialized
// as XML fixes void tags, entities and stray "<" in prose (e.g. "<1, ...>")
function toXhtml(fragment: string): string {
  const body = cheerio.load(fragment, null, false).html({ xml: true });
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}

const RELATIVE_UNITS: [RegExp, number][] = [
  [/(\d+)\s*min/, 60 * 1000],
  [/(\d+)\s*hour/, 60 * 60 * 1000],
  [/(\d+)\s*day/, 24 * 60 * 60 * 1000],
  [/(\d+)\s*week/, 7 * 24 * 60 * 60 * 1000],
  [/(\d+)\s*month/, 30 * 24 * 60 * 60 * 1000],
  [/(\d+)\s*year/, 365 * 24 * 60 * 60 * 1000],
];

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function parseRelativeDate(dateText: string): Date | undefined {
  const now = new Date();
  const text = dateText.toLowerCase();

  if (text.includes("now") || text.includes("second")) {
    return now;
  }

  for (const [regex, multiplier] of RELATIVE_UNITS) {
    const match = text.match(regex);
    if (match?.[1]) {
      return new Date(now.getTime() - parseInt(match[1]) * multiplier);
    }
  }

  const dateMatch = text.match(/(\w+)\s+(\d+),\s+(\d+)/);
  if (dateMatch?.[1] && dateMatch[2] && dateMatch[3]) {
    const month = MONTH_NAMES.findIndex((m) => dateMatch[1]!.startsWith(m));
    if (month !== -1) {
      return new Date(parseInt(dateMatch[3]), month, parseInt(dateMatch[2]));
    }
  }

  return undefined; // no date beats a fake "just published"
}

function fixImageUrl(url: string): string {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return "https:" + trimmed;
  if (trimmed.startsWith("http://")) return "https://" + trimmed.slice(7);
  if (trimmed.startsWith("/")) return DOMAIN + trimmed;
  return trimmed;
}

function extractMangaSlug(url: string): string {
  if (!url || !url.includes("/manga/")) return "";
  return url.split("/manga/")[1]?.replace(/\/$/, "") ?? "";
}

function extractChapterId(url: string): string {
  const match = url.match(/\/ch[\d.]+-(\d+)/);
  return match?.[1] ?? "";
}
