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
import { MATURE_GENRES, type MangaCard } from "./models";

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();

const toAbsoluteUrl = (url: string): string => {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${getBaseUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
};

// Manga links are /title/<slug>, chapter links /read/<id>.
const slugFromHref = (href: string | undefined): string | undefined =>
  /\/title\/([^/?#]+)/.exec(href ?? "")?.[1];

const chapterIdFromHref = (href: string | undefined): string | undefined =>
  /\/read\/(\d+)/.exec(href ?? "")?.[1];

const genreIdFromHref = (href: string | undefined): string | undefined =>
  /\/genre\/([^/?#]+)/.exec(href ?? "")?.[1];

// Cards print the status in lower case ("ongoing") or as "ONGOING STORY".
const formatStatus = (value: string): string | undefined => {
  const status = value
    .replace(/\bstory\b/i, "")
    .trim()
    .toLowerCase();
  return status ? status[0].toUpperCase() + status.slice(1) : undefined;
};

// The site shows an unrated title as 0.0.
const parseRating = (text: string): string | undefined => {
  const value = /\d+(?:\.\d+)?/.exec(text)?.[0];
  return value && parseFloat(value) > 0 ? value : undefined;
};

const parseChapterNumber = (value: string): number | undefined => {
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  return match ? parseFloat(match[1]) : undefined;
};

// Card labels carry the chapter's tags ("Ch. 117 END ENG"); a card shows only its number.
const formatChapterLabel = (label: string | undefined): string | undefined => {
  if (!label) return undefined;
  const number = /^Ch\.\s*(\d+(?:\.\d+)?)/i.exec(label)?.[1];
  return number ? `Ch. ${number}` : label.replace(/^Ch\.\s*VOL\s*/i, "Vol. ");
};

export const contentRatingForGenres = (genres: string[]): ContentRating =>
  genres.some((genre) => MATURE_GENRES.includes(genre.trim().toLowerCase()))
    ? ContentRating.MATURE
    : ContentRating.EVERYONE;

// Reads a home-page grid card and a catalogue list card alike.
const parseCard = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): MangaCard | undefined => {
  const titleLink = card.find("h3 a, h2 a").first();
  const slug = slugFromHref(titleLink.attr("href"));
  const title = cleanText(titleLink.text());
  if (!slug || !title) return undefined;

  const chapterLink = card.find("a.latest-chapter, a.cherri-list-card__action").first();
  const chapterLabel = cleanText(
    chapterLink.find("span").first().text() || chapterLink.text().replace("→", ""),
  );
  return {
    slug,
    title,
    cover: toAbsoluteUrl(card.find("img").first().attr("src") ?? ""),
    status: formatStatus(cleanText(card.find(".cover-status, small.eyebrow").first().text())),
    rating: parseRating(
      card
        .find(".cherri-card-rating, .cherri-list-card__meta span")
        .filter((_, element) => $(element).text().includes("★"))
        .first()
        .text(),
    ),
    genres: card
      .find(".genre-badges a, .cherri-detail__chips a")
      .toArray()
      .map((element) => cleanText($(element).text()))
      .filter(Boolean),
    chapterId: chapterIdFromHref(chapterLink.attr("href")),
    chapterLabel: chapterLabel || undefined,
    postedAt: card.find("time").first().attr("datetime"),
  };
};

const parseCards = ($: cheerio.CheerioAPI, cards: cheerio.Cheerio<AnyNode>): MangaCard[] =>
  cards.toArray().flatMap((element) => {
    const card = parseCard($, $(element));
    return card ? [card] : [];
  });

// A home-page section is found by its heading, as the page names it.
export const parseHomeSection = (html: string, heading: string): MangaCard[] => {
  const $ = cheerio.load(html);
  const grid = $(".cherri-section-heading h2")
    .filter((_, element) => cleanText($(element).text()).toLowerCase() === heading.toLowerCase())
    .first()
    .closest(".cherri-section-heading")
    .nextAll(".cherri-grid")
    .first();
  return parseCards($, grid.find("article.manga-card"));
};

export const parseCataloguePage = (html: string): { cards: MangaCard[]; hasNextPage: boolean } => {
  const $ = cheerio.load(html);
  return {
    cards: parseCards($, $("article.cherri-list-card")),
    hasNextPage: $("nav.pager a")
      .toArray()
      .some((element) => /next/i.test($(element).text())),
  };
};

export const toFeaturedItem = (card: MangaCard): DiscoverSectionItem => {
  const chapter = formatChapterLabel(card.chapterLabel);
  const infoItems = [
    ...(card.rating ? [{ symbol: "star.fill", text: card.rating }] : []),
    ...(chapter ? [{ symbol: "book.fill", text: chapter }] : []),
  ];
  return {
    type: "featuredCarouselItem",
    mangaId: card.slug,
    imageUrl: card.cover,
    title: card.title,
    supertitle: card.status,
    summary: card.genres.slice(0, 2).join(" • ") || undefined,
    infoItems: (infoItems.length > 0 ? infoItems : undefined) as FeaturedCarouselItem["infoItems"],
    contentRating: contentRatingForGenres(card.genres),
  };
};

export const toProminentItem = (card: MangaCard): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: card.slug,
  imageUrl: card.cover,
  title: card.title,
  subtitle: formatChapterLabel(card.chapterLabel),
  contentRating: contentRatingForGenres(card.genres),
});

export const toCarouselItem = (card: MangaCard): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: card.slug,
  imageUrl: card.cover,
  title: card.title,
  subtitle: formatChapterLabel(card.chapterLabel),
  contentRating: contentRatingForGenres(card.genres),
});

export const toChapterUpdateItems = (cards: MangaCard[]): DiscoverSectionItem[] =>
  cards.flatMap((card) =>
    card.chapterId
      ? [
          {
            type: "chapterUpdatesCarouselItem",
            mangaId: card.slug,
            chapterId: card.chapterId,
            imageUrl: card.cover,
            title: card.title,
            subtitle: formatChapterLabel(card.chapterLabel),
            publishDate: card.postedAt ? new Date(card.postedAt) : undefined,
            contentRating: contentRatingForGenres(card.genres),
          },
        ]
      : [],
  );

export const toSearchResultItem = (card: MangaCard): SearchResultItem => ({
  mangaId: card.slug,
  title: card.title,
  imageUrl: card.cover,
  subtitle: formatChapterLabel(card.chapterLabel),
  contentRating: contentRatingForGenres(card.genres),
});

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const $ = cheerio.load(html);
  const detail = $(".cherri-detail").first();
  const title = cleanText(detail.find("h1").first().text());
  if (!title) throw new Error(`No details found for ${mangaId}`);

  const seen = new Set<string>();
  const tags: Tag[] = detail
    .find(".cherri-detail__chips a")
    .toArray()
    .flatMap((element) => {
      const id = genreIdFromHref($(element).attr("href"));
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, title: cleanText($(element).text()) }];
    });

  const stat = (label: string): string =>
    cleanText(
      detail
        .find(".cherri-detail__stats > div")
        .filter((_, element) => cleanText($(element).find("small").text()) === label)
        .find("strong")
        .text(),
    );
  const rating = parseRating(stat("RATING"));
  const alternative = cleanText(detail.find(".cherri-detail__alt").first().text());
  const author = cleanText(detail.find(".cherri-detail__description + p strong").first().text());

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: alternative ? [alternative] : [],
      thumbnailUrl: toAbsoluteUrl(
        detail.find(".cherri-detail__cover img").first().attr("src") ?? "",
      ),
      synopsis: cleanText(detail.find(".cherri-detail__description").first().text()),
      author: author || undefined,
      // The eyebrow reads "ROSE LIBRARY · COMPLETED".
      status: formatStatus(
        cleanText(detail.find("p.eyebrow").first().text()).split("·").pop() ?? "",
      ),
      rating: rating ? Math.min(1, parseFloat(rating) / 5) : undefined,
      contentRating: contentRatingForGenres(tags.map((tag) => tag.title)),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      shareUrl: `${getBaseUrl()}/title/${mangaId}`,
    },
  };
};

export const parseChapters = (html: string, sourceManga: SourceManga): Chapter[] => {
  const $ = cheerio.load(html);
  const rows = $("a.cherri-chapter-row").toArray();

  const seen = new Set<string>();
  const chapters = rows.flatMap((element, index): Chapter[] => {
    const row = $(element);
    const chapterId = chapterIdFromHref(row.attr("href"));
    if (!chapterId || seen.has(chapterId)) return [];
    seen.add(chapterId);

    // Names read "Chapter 500.5 OMAKE"; whatever follows the number is the chapter's title.
    const name = cleanText(row.find("strong").first().text());
    const numbered = /^chapter\s+(\d+(?:\.\d+)?)\s*(.*)$/i.exec(name);
    const date = new Date(row.find("time").attr("datetime") ?? "");
    return [
      {
        chapterId,
        sourceManga,
        langCode: "en",
        chapNum: numbered ? parseFloat(numbered[1]) : (parseChapterNumber(name) ?? 0),
        title: (numbered ? numbered[2] : name) || undefined,
        publishDate: isNaN(date.getTime()) ? undefined : date,
        sortingIndex: rows.length - index,
      },
    ];
  });

  if (chapters.length === 0) throw new Error(`No chapters found for ${sourceManga.mangaId}`);
  return chapters;
};

export const parsePages = (html: string, chapter: Chapter): ChapterDetails => {
  const $ = cheerio.load(html);
  const pages = $("#chapter-reader img[data-page]")
    .toArray()
    .map((element) => toAbsoluteUrl($(element).attr("src") ?? ""))
    .filter(Boolean);

  if (pages.length === 0) throw new Error(`No pages found for chapter ${chapter.chapterId}`);
  return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
};
