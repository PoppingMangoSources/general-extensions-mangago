/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { getBaseUrl } from "./forms";
import { GENRES, MATURE_GENRES, type MangaCard } from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();

const toAbsoluteUrl = (url: string): string => {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${getBaseUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
};

// Manga links are /title/<slug>, chapter links /read/<slug>/<id>.
const slugFromHref = (href: string | undefined): string | undefined =>
  /\/title\/([^/?#]+)/.exec(href ?? "")?.[1];

const chapterIdFromHref = (href: string | undefined): string | undefined =>
  /\/read\/[^/]+\/(\d+)/.exec(href ?? "")?.[1];

const formatStatus = (value: string): string | undefined => {
  const status = value.trim().toLowerCase();
  return status ? status[0].toUpperCase() + status.slice(1) : undefined;
};

// Chapter rows date themselves "Dec 19, 2025".
const parseDate = (value: string): Date | undefined => {
  const match = /([a-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/i.exec(value);
  const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
  return match && month >= 0
    ? new Date(Date.UTC(Number(match[3]), month, Number(match[2])))
    : undefined;
};

export const contentRatingForGenres = (genres: string[]): ContentRating =>
  genres.some((genre) => MATURE_GENRES.includes(genre.trim().toLowerCase()))
    ? ContentRating.MATURE
    : ContentRating.EVERYONE;

const parseCard = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): MangaCard | undefined => {
  const slug = slugFromHref(card.find('a[href*="/title/"]').first().attr("href"));
  const title = cleanText(card.find("h3").first().text());
  if (!slug || !title) return undefined;

  // The meta line reads "Action · 370 chapters".
  const meta = card
    .find(".card-meta span")
    .toArray()
    .map((element) => cleanText($(element).text()));
  const count = meta.map((text) => /^([\d,]+)\s+chapters?$/i.exec(text)?.[1]).find(Boolean);
  return {
    slug,
    title,
    cover: toAbsoluteUrl(card.find("img").first().attr("src") ?? ""),
    status: formatStatus(cleanText(card.find(".cover-label").first().text())),
    genre: meta.find((text) => !/\bchapters?$/i.test(text)),
    chapters: count ? `${count} ${count === "1" ? "Chap" : "Chaps"}` : undefined,
  };
};

const parseCards = ($: cheerio.CheerioAPI, cards: cheerio.Cheerio<AnyNode>): MangaCard[] =>
  cards.toArray().flatMap((element) => {
    const card = parseCard($, $(element));
    return card ? [card] : [];
  });

// The discover page's Popular manga carousel.
export const parsePopularCards = (html: string): MangaCard[] => {
  const $ = cheerio.load(html);
  return parseCards($, $("section.popular-manga article.manga-card"));
};

export const parseBrowsePage = (html: string): { cards: MangaCard[]; hasNextPage: boolean } => {
  const $ = cheerio.load(html);
  return {
    cards: parseCards($, $("[data-browse-results] article.manga-card")),
    hasNextPage: $("nav.pagination a")
      .toArray()
      .some((element) => /next/i.test($(element).text())),
  };
};

const cardContentRating = (card: MangaCard): ContentRating =>
  contentRatingForGenres(card.genre ? [card.genre] : []);

export const toFeaturedItem = (card: MangaCard): DiscoverSectionItem => {
  const infoItems = [
    ...(card.chapters ? [{ symbol: "books.vertical.fill", text: card.chapters }] : []),
    ...(card.status ? [{ symbol: "book.fill", text: card.status }] : []),
  ];
  return {
    type: "featuredCarouselItem",
    mangaId: card.slug,
    imageUrl: card.cover,
    title: card.title,
    supertitle: card.genre,
    infoItems: (infoItems.length > 0 ? infoItems : undefined) as FeaturedCarouselItem["infoItems"],
    contentRating: cardContentRating(card),
  };
};

export const toProminentItem = (card: MangaCard): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: card.slug,
  imageUrl: card.cover,
  title: card.title,
  subtitle: card.chapters,
  contentRating: cardContentRating(card),
});

export const toCarouselItem = (card: MangaCard): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: card.slug,
  imageUrl: card.cover,
  title: card.title,
  subtitle: card.chapters,
  contentRating: cardContentRating(card),
});

export const toSearchResultItem = (card: MangaCard): SearchResultItem => ({
  mangaId: card.slug,
  title: card.title,
  imageUrl: card.cover,
  subtitle: card.chapters,
  contentRating: cardContentRating(card),
});

// Tags use the genre filter's own ids, so a tapped tag filters the same way.
const genreTag = (name: string): Tag => ({
  id:
    GENRES.find((genre) => genre.title.toLowerCase() === name.toLowerCase())?.id ??
    name.toLowerCase().replace(SAFE_ID_REGEX, "-"),
  title: name,
});

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const $ = cheerio.load(html);
  const detail = $("section.detail").first();
  const title = cleanText(detail.find("h1").first().text());
  if (!title) throw new Error(`No details found for ${mangaId}`);

  const seen = new Set<string>();
  const tags = detail
    .find(".tags a")
    .toArray()
    .flatMap((element) => {
      const tag = genreTag(cleanText($(element).text()));
      if (!tag.title || seen.has(tag.id)) return [];
      seen.add(tag.id);
      return [tag];
    });
  const author = cleanText(detail.find("h1 + p.muted").first().text());
  const rating = parseFloat($("[data-rating-average]").first().text());

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl: toAbsoluteUrl(detail.find("img.detail-cover").first().attr("src") ?? ""),
      synopsis: cleanText(detail.find("p.synopsis").first().text()),
      author: author || undefined,
      // The eyebrow reads "completed · 38 CHAPTERS".
      status: formatStatus(cleanText(detail.find(".eyebrow").first().text()).split("·")[0]),
      rating: rating > 0 ? Math.min(1, rating / 5) : undefined,
      contentRating: contentRatingForGenres(tags.map((tag) => tag.title)),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      shareUrl: `${getBaseUrl()}/title/${mangaId}`,
    },
  };
};

// The list holds a Chapters, a Volumes and a RAW tab, each newest first, in that order.
export const parseChapters = (html: string, sourceManga: SourceManga): Chapter[] => {
  const $ = cheerio.load(html);
  const rows = $(".chapter-list a[data-chapter-group]").toArray();

  const seen = new Set<string>();
  const chapters = rows.flatMap((element, index): Chapter[] => {
    const row = $(element);
    const chapterId = chapterIdFromHref(row.attr("href"));
    if (!chapterId || seen.has(chapterId)) return [];
    seen.add(chapterId);

    // Names read "Chapter 202 END", "Chapter Side Story" or "Volume 13"; a volume keeps its
    // name as its title.
    const name = cleanText(row.find("strong").first().text());
    const chapter = /^chapter\s+(\d+(?:\.\d+)?)?\s*(.*)$/i.exec(name);
    return [
      {
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum: chapter?.[1] ? parseFloat(chapter[1]) : 0,
        title: (chapter ? chapter[2] : name) || undefined,
        volume: 0,
        version: row.attr("data-chapter-group") === "raw" ? "RAW" : undefined,
        publishDate: parseDate(row.find("span").first().text()),
        sortingIndex: rows.length - index,
      },
    ];
  });

  if (chapters.length === 0) throw new Error(`No chapters found for ${sourceManga.mangaId}`);
  return chapters;
};

export const parsePages = (html: string, chapter: Chapter): ChapterDetails => {
  const $ = cheerio.load(html);
  const pages = $("img[data-page-image]")
    .toArray()
    .map((element) => toAbsoluteUrl($(element).attr("src") ?? ""))
    .filter(Boolean);

  if (pages.length === 0) throw new Error(`No pages found for chapter ${chapter.chapterId}`);
  return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
};
