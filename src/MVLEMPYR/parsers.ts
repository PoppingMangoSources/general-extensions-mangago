/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type ChapterUpdatesCarouselItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SimpleCarouselItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  type CatalogueNovel,
  type CatalogueNovelResponse,
  type ChapterPostResponse,
  type HomeCard,
} from "./models";
import { coverUrl, novelUrl } from "./network";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const ADULT_GENRES = new Set(["adult", "smut"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "yaoi", "yuri", "harem"]);

const cleanText = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeId = (value: string): string => value.replace(SAFE_ID_REGEX, "-");

export const parseNovelSlug = (value?: string | null): string =>
  sanitizeId((value ?? "").match(/\/novel\/([^/?#]+)/i)?.[1] ?? "");

const toNumber = (value?: number | string): number | undefined => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

// The chapter feed keys posts by a tag derived from the novel code:
// tagId = 7^code mod 1999999997, computed with 16-bit split products so the
// intermediate values stay inside Number's safe integer range.
const TAG_MODULUS = 1_999_999_997;

const mulmod = (left: number, right: number): number => {
  const high = Math.floor(right / 65536);
  const low = right % 65536;
  return (((left * high) % TAG_MODULUS) * 65536 + left * low) % TAG_MODULUS;
};

export const chapterTagId = (code: number): number => {
  let result = 1;
  let base = 7 % TAG_MODULUS;
  let exponent = code;
  while (exponent > 0) {
    if (exponent % 2 === 1) result = mulmod(result, base);
    base = mulmod(base, base);
    exponent = Math.floor(exponent / 2);
  }
  return result;
};

export const toCatalogueNovel = (value: unknown): CatalogueNovel | undefined => {
  if (value == null || typeof value !== "object") return undefined;
  const raw = value as CatalogueNovelResponse;
  const name = cleanText(raw.name);
  const slug = sanitizeId((raw.slug ?? "").trim());
  const code = toNumber(raw["novel-code"]);
  if (!name || !slug || code == null) return undefined;
  const created = raw.createdOn ? new Date(raw.createdOn).getTime() : Number.NaN;
  return {
    name,
    slug,
    code,
    rating: toNumber(raw["average-review"]),
    reviews: toNumber(raw["total-reviews"]),
    chapters: toNumber(raw["total-chapters"]),
    created: Number.isFinite(created) ? created : undefined,
    genres: (raw.genre ?? []).map((genre) => cleanText(genre)).filter((genre) => genre.length > 0),
    author: cleanText(raw["author-name"]) || undefined,
    status: cleanText(raw.status) || undefined,
  };
};

export const parseHomeCards = ($: cheerio.CheerioAPI, sectionClass: string): HomeCard[] => {
  const cards: HomeCard[] = [];
  const seen = new Set<string>();
  $(`section.${sectionClass} [role=listitem]`).each((_, element) => {
    const item = $(element);
    const link = item.find('a[href*="/novel/"]').first();
    const slug = parseNovelSlug(link.attr("href"));
    if (!slug || seen.has(slug)) return;

    const image = item.find("img").first();
    const title = cleanText(
      item.find(".namex115, .namex175, .selectname, .vertical-list-novel-name").first().text() ||
        image.attr("alt") ||
        link.attr("title"),
    );
    if (!title) return;
    seen.add(slug);

    // Vertical widget rows repeat one value class: index 0 is the chapter
    // count, index 1 the rating.
    const homeCounts = item
      .find(".chapter-count-home")
      .toArray()
      .map((count) => cleanText($(count).text()))
      .filter((count) => count.length > 0);

    cards.push({
      slug,
      title,
      imageUrl: image.attr("src") ?? "",
      rating: cleanText(item.find(".mini-rating-text").first().text()) || homeCounts[1],
      status:
        cleanText(
          item
            .find(".novelstatustext, .novelstatustextmedium, .novelstatustextlarge")
            .first()
            .text(),
        ) || undefined,
      chapter: homeCounts[0],
    });
  });
  return cards;
};

export const parseNovelCode = ($: cheerio.CheerioAPI): number | undefined =>
  toNumber(cleanText($("#novel-code").first().text()));

const parseStatus = (status: string): string => {
  const value = status.toLowerCase();
  if (value.includes("complet")) return "Completed";
  if (value.includes("ongoing")) return "Ongoing";
  if (value.includes("hiatus")) return "Hiatus";
  if (value.includes("drop")) return "Dropped";
  return "Unknown";
};

export const parseNovelDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const title = cleanText($("h1.novel-title, .novel-title2").first().text()) || mangaId;

  let synopsis = "";
  $(".synopsis p").each((_, element) => {
    const text = cleanText($(element).text());
    if (text) synopsis += (synopsis ? "\n\n" : "") + text;
  });
  if (!synopsis) synopsis = cleanText($(".synopsis").first().text());

  let author = "";
  $(".textwrapper").each((_, element) => {
    if (author) return;
    const text = cleanText($(element).text());
    const match = text.match(/^Author:\s*(.+)$/i);
    if (match) author = match[1];
  });

  const genreTags: Tag[] = [];
  const seenGenres = new Set<string>();
  $(".genre-tags").each((_, element) => {
    const genre = cleanText($(element).text());
    if (!genre) return;
    const id = sanitizeId(genre.toLowerCase().replace(/\s+/g, "-"));
    if (seenGenres.has(id)) return;
    seenGenres.add(id);
    genreTags.push({ id, title: genre });
  });
  const tagGroups: TagSection[] =
    genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

  const code = parseNovelCode($);
  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl:
        $("img.novel-image, img.novel-image2").first().attr("src") ??
        (code != null ? coverUrl(code) : ""),
      synopsis,
      author: author || undefined,
      status: parseStatus(cleanText($(".novelstatustextlarge").first().text())),
      contentRating: contentRatingForGenres(genreTags.map((tag) => tag.title)),
      contentType: "novel",
      tagGroups,
      shareUrl: novelUrl(mangaId),
    },
  };
};

export const buildChapters = (
  posts: ChapterPostResponse[],
  sourceManga: SourceManga,
): Chapter[] => {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    const number = toNumber(post.acf?.chapter_number);
    const code = toNumber(post.acf?.novel_code);
    if (number == null || code == null) continue;
    const chapterId = `${code}-${number}`;
    if (seen.has(chapterId)) continue;
    seen.add(chapterId);

    const date = post.date ? new Date(post.date) : undefined;
    chapters.push({
      chapterId,
      sourceManga,
      langCode: "en",
      chapNum: number,
      volume: 0,
      title: cleanText(post.acf?.ch_name) || undefined,
      publishDate: date != null && !Number.isNaN(date.getTime()) ? date : undefined,
    });
  }
  chapters.sort((left, right) => right.chapNum - left.chapNum);
  return chapters.map((chapter, index) => ({
    ...chapter,
    sortingIndex: chapters.length - index,
  }));
};

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The reader parses chapters as XHTML, so serialize through cheerio to keep
// the original structure with self-closed void elements.
export const parseChapterDetails = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const content = $("#chapter").first();
  const html = (content.find("span").first().html() ?? content.html() ?? "").trim();
  if (!html) {
    throw new Error(`No content returned for chapter ${chapter.chapterId}`);
  }
  const body = cheerio.load(html, null, false).html({ xml: true });
  const heading = chapter.title ? `<h2>${escapeXml(chapter.title)}</h2>` : "";
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: `<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/></head><body>${heading}${body}</body></html>`,
  };
};

const formatRating = (rating?: number | string): string | undefined => {
  const value = typeof rating === "number" ? rating.toFixed(1) : rating?.trim();
  return value ? `★ ${value}` : undefined;
};

const formatChapterCount = (chapters?: number | string): string | undefined => {
  const value = typeof chapters === "number" ? `${chapters}` : chapters?.trim();
  return value ? `Ch. ${value}` : undefined;
};

const twoInfoItems = (
  items: { symbol: string; text: string }[],
): FeaturedCarouselItem["infoItems"] =>
  items.length === 0 ? undefined : items.length === 1 ? [items[0]] : [items[0], items[1]];

export const toFeaturedHomeItem = (card: HomeCard): FeaturedCarouselItem => {
  const infoItems: { symbol: string; text: string }[] = [];
  if (card.rating) infoItems.push({ symbol: "star.fill", text: card.rating });
  if (card.status) infoItems.push({ symbol: "book.closed", text: card.status });
  return {
    type: "featuredCarouselItem",
    mangaId: card.slug,
    imageUrl: card.imageUrl,
    title: card.title,
    infoItems: twoInfoItems(infoItems),
  };
};

export const toSimpleHomeItem = (card: HomeCard): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: card.slug,
  imageUrl: card.imageUrl,
  title: card.title,
  subtitle:
    [formatChapterCount(card.chapter), formatRating(card.rating)]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
});

export const toFeaturedCatalogueItem = (
  novel: CatalogueNovel,
  author?: string,
  summary?: string,
): FeaturedCarouselItem => {
  const infoItems: { symbol: string; text: string }[] = [];
  const rating = formatRating(novel.rating);
  if (rating) infoItems.push({ symbol: "star.fill", text: rating.replace("★ ", "") });
  const chapterCount = formatChapterCount(novel.chapters);
  if (chapterCount) infoItems.push({ symbol: "book.fill", text: chapterCount });
  return {
    type: "featuredCarouselItem",
    mangaId: novel.slug,
    imageUrl: coverUrl(novel.code),
    title: novel.name,
    supertitle: author ?? novel.author,
    summary,
    infoItems: twoInfoItems(infoItems),
    contentRating: contentRatingForGenres(novel.genres),
  };
};

export const toSimpleCatalogueItem = (novel: CatalogueNovel): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: novel.slug,
  imageUrl: coverUrl(novel.code),
  title: novel.name,
  subtitle:
    [formatChapterCount(novel.chapters), formatRating(novel.rating)]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(novel.genres),
});

export const toSearchResultItem = (novel: CatalogueNovel): SearchResultItem => ({
  mangaId: novel.slug,
  title: novel.name,
  imageUrl: coverUrl(novel.code),
  subtitle:
    [formatChapterCount(novel.chapters), formatRating(novel.rating)]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(novel.genres),
});

export const toChapterUpdateItem = (
  post: ChapterPostResponse,
  novel: CatalogueNovel,
): ChapterUpdatesCarouselItem | undefined => {
  const number = toNumber(post.acf?.chapter_number);
  if (number == null) return undefined;
  const date = post.date ? new Date(post.date) : undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: novel.slug,
    chapterId: `${novel.code}-${number}`,
    imageUrl: coverUrl(novel.code, 300),
    title: novel.name,
    subtitle: `Ch. ${number}`,
    publishDate: date != null && !Number.isNaN(date.getTime()) ? date : undefined,
    contentRating: contentRatingForGenres(novel.genres),
  };
};
