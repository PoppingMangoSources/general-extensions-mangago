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
import { HOME_TITLES, MATURE_GENRES, RANKED_LIMIT, type MangaCard } from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_ID_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();

const absoluteUrl = (url: string): string => {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${getBaseUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
};

// Manga links are /<slug>; chapter links are /<slug>/<chapterId> (the leading
// slash is sometimes dropped). The slug is the manga id, the trailing number
// the chapter id.
const SLUG_ONLY_REGEX = /^\/?[^/]+\/?$/;
const CHAPTER_HREF_REGEX = /^\/?[^/]+\/\d+/;

const slugFromHref = (href: string | undefined): string =>
  (href ?? "").replace(/^\//, "").split(/[/?#]/)[0] ?? "";

const chapterIdFromHref = (href: string | undefined): string | undefined =>
  /\/([0-9]+)\/?(?:[?#]|$)/.exec(href ?? "")?.[1];

const ratingFrom = (text: string): string | undefined => {
  const value = /[\d.]+/.exec(text)?.[0];
  return value && parseFloat(value) > 0 ? value : undefined;
};

const chapterNumberFrom = (value: string): number | undefined => {
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  return match ? parseFloat(match[1]) : undefined;
};

// Update labels are relative ("13 mins ago", "7 days ago"); sum the units back
// from now and clamp anything ahead of the clock.
const parseRelativeDate = (value: string): Date | undefined => {
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (text.includes("just now") || text.includes("less than")) return new Date();

  const units: [RegExp, number][] = [
    [/(\d+)\s*sec/, 1_000],
    [/(\d+)\s*min/, 60_000],
    [/(\d+)\s*hour/, 3_600_000],
    [/(\d+)\s*day/, 86_400_000],
    [/(\d+)\s*week/, 604_800_000],
    [/(\d+)\s*month/, 2_629_800_000],
    [/(\d+)\s*year/, 31_557_600_000],
  ];
  let offset = 0;
  for (const [pattern, factor] of units) {
    const amount = Number(pattern.exec(text)?.[1] ?? 0);
    if (amount) offset += amount * factor;
  }
  return offset > 0 ? new Date(Date.now() - offset) : undefined;
};

export const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.trim().toLowerCase());
  return normalized.some((genre) => MATURE_GENRES.includes(genre))
    ? ContentRating.MATURE
    : ContentRating.EVERYONE;
};

const coverFrom = (element: cheerio.Cheerio<AnyNode>): string => {
  const img = element.find("img").first();
  return absoluteUrl(img.attr("data-src") ?? img.attr("src") ?? "");
};

// Every card is bare anchors: a cover link, a title link, then a chapter link
// (/<slug>/<id>). Links are told apart by their href shape.
const parseCard = (
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<AnyNode>,
): MangaCard | undefined => {
  const links = item
    .find("a[href]")
    .toArray()
    .map((element) => $(element));
  const slugOnly = links.filter((link) => SLUG_ONLY_REGEX.test(link.attr("href") ?? ""));
  const chapterLink = links.find((link) => CHAPTER_HREF_REGEX.test(link.attr("href") ?? ""));

  const slug = slugFromHref((slugOnly[0] ?? links[0])?.attr("href"));
  const title = cleanText(slugOnly.find((link) => link.find("img").length === 0)?.text() ?? "");
  if (!slug || !title) return undefined;

  return {
    slug,
    title,
    cover: coverFrom(item),
    rating: ratingFrom(item.find(".row.align-center span").last().text()),
    chapterId: chapterIdFromHref(chapterLink?.attr("href")),
    chapterLabel: chapterLink ? cleanText(chapterLink.text()) || undefined : undefined,
    genres: [],
  };
};

// Locate a home section by its heading text, then read every card under it.
export const parseCarouselSection = ($: cheerio.CheerioAPI, title: string): MangaCard[] =>
  $(".section-title")
    .filter((_, element) => cleanText($(element).text()) === title)
    .first()
    .closest(".section-container")
    .find(".manga-item")
    .toArray()
    .flatMap((element) => {
      const card = parseCard($, $(element));
      return card ? [card] : [];
    });

// The Latest Update block is a horizontal grid whose cards carry a numeric
// rating, the newest chapter, and a relative timestamp.
export const parseLatestSection = ($: cheerio.CheerioAPI): MangaCard[] =>
  $(".section-title")
    .filter((_, element) => cleanText($(element).text()) === HOME_TITLES.LATEST)
    .first()
    .closest(".section-container")
    .find(".manga-horizontal-item")
    .toArray()
    .flatMap((element) => {
      const item = $(element);
      const links = item
        .find("a[href]")
        .toArray()
        .map((anchor) => $(anchor));
      const slug = slugFromHref(
        links.find((link) => SLUG_ONLY_REGEX.test(link.attr("href") ?? ""))?.attr("href"),
      );
      const title = cleanText(
        links
          .find(
            (link) =>
              SLUG_ONLY_REGEX.test(link.attr("href") ?? "") && link.find("img").length === 0,
          )
          ?.text() ?? "",
      );
      if (!slug || !title) return [];

      // The first row with a chapter link is the latest update; the other
      // .row.align-center rows hold the star rating and older chapters.
      const chapterRow = item.find(".row.align-center:has(a.episode)").first();
      const chapterLink = chapterRow.find("a.episode").first();

      return [
        {
          slug,
          title,
          cover: coverFrom(item),
          rating: ratingFrom(item.find(".row.align-center > span").first().text()),
          chapterId: chapterIdFromHref(chapterLink.attr("href")),
          chapterLabel: cleanText(chapterLink.text()) || undefined,
          updatedAt: cleanText(chapterRow.find(".episode-date").first().text()) || undefined,
          genres: item
            .find('a[href*="genre.php"]')
            .toArray()
            .map((genre) => cleanText($(genre).text()))
            .filter(Boolean),
        },
      ];
    });

export const parseListingCards = (html: string): MangaCard[] => {
  const $ = cheerio.load(html);
  return $(".manga-item")
    .toArray()
    .flatMap((element) => {
      const card = parseCard($, $(element));
      return card ? [card] : [];
    });
};

// Most Viewed leads with the rating; the listing carries no view count, so
// views live on the details page only.
export const toFeaturedItems = (cards: MangaCard[]): DiscoverSectionItem[] =>
  cards.map((card) => {
    const rating = card.rating ? { symbol: "star.fill" as const, text: card.rating } : undefined;
    return {
      type: "featuredCarouselItem",
      mangaId: card.slug,
      imageUrl: card.cover,
      title: card.title,
      infoItems: (rating ? [rating] : undefined) as FeaturedCarouselItem["infoItems"],
      contentRating: contentRatingForGenres(card.genres),
    };
  });

// Popular Today: chapter number + rating.
export const toRatedChapterItems = (cards: MangaCard[]): DiscoverSectionItem[] =>
  cards.map((card) => {
    const chapNum = card.chapterLabel ? chapterNumberFrom(card.chapterLabel) : undefined;
    return {
      type: "simpleCarouselItem",
      mangaId: card.slug,
      imageUrl: card.cover,
      title: card.title,
      subtitle: [
        chapNum !== undefined ? `Ch. ${chapNum}` : undefined,
        card.rating ? `★ ${card.rating}` : undefined,
      ]
        .filter(Boolean)
        .join(" • "),
      contentRating: contentRatingForGenres(card.genres),
    };
  });

// Weekly and the genre carousels: rank number + chapter number, capped so a
// long genre listing stays a short "top" carousel.
export const toRankedItems = (cards: MangaCard[]): DiscoverSectionItem[] =>
  cards.slice(0, RANKED_LIMIT).map((card, index) => {
    const chapNum = card.chapterLabel ? chapterNumberFrom(card.chapterLabel) : undefined;
    return {
      type: "simpleCarouselItem",
      mangaId: card.slug,
      imageUrl: card.cover,
      title: card.title,
      subtitle: [`#${index + 1}`, chapNum !== undefined ? `Ch. ${chapNum}` : undefined]
        .filter(Boolean)
        .join(" • "),
      contentRating: contentRatingForGenres(card.genres),
    };
  });

export const toLatestItems = (cards: MangaCard[]): DiscoverSectionItem[] =>
  cards.flatMap((card) => {
    if (!card.chapterId) return [];
    const chapNum = card.chapterLabel ? chapterNumberFrom(card.chapterLabel) : undefined;
    return [
      {
        type: "chapterUpdatesCarouselItem",
        mangaId: card.slug,
        chapterId: card.chapterId,
        imageUrl: card.cover,
        title: card.title,
        subtitle: [
          chapNum !== undefined ? `Ch. ${chapNum}` : undefined,
          card.rating ? `★ ${card.rating}` : undefined,
        ]
          .filter(Boolean)
          .join(" • "),
        publishDate: card.updatedAt ? parseRelativeDate(card.updatedAt) : undefined,
        contentRating: contentRatingForGenres(card.genres),
      },
    ];
  });

export const toSearchResultItems = (cards: MangaCard[]): SearchResultItem[] =>
  cards.map((card) => ({
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.cover,
    subtitle: card.rating ? `★ ${card.rating}` : undefined,
    contentRating: contentRatingForGenres(card.genres),
  }));

// Read a labelled attribute from the details sidebar (Status, Released, …).
const detailField = ($: cheerio.CheerioAPI, label: string): string =>
  cleanText(
    $(".section-status.row, .comic-attrs .column")
      .toArray()
      .map((element) => $(element))
      .find((row) => cleanText(row.children().first().text()) === label)
      ?.children()
      .last()
      .text() ?? "",
  );

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const $ = cheerio.load(html);

  const title = cleanText($("h1.story-name").first().text());
  if (!title) {
    throw new Error(`No details found for ${mangaId}`);
  }

  // The inline cover is the real image; og:image is a generic site card.
  const thumbnailUrl = absoluteUrl($("img.comic-img").first().attr("src") ?? "");
  const synopsis = cleanText($(".story-desc").first().text());
  const author = cleanText($('.comic-attrs a[href*="/author/"]').first().text());
  const status = detailField($, "Status");

  // Secondary titles sit in the header subtitle, separated by semicolons; the
  // commas inside a romanised title are part of it, so don't split on those.
  const secondaryTitles = cleanText($(".comic-info-container h2").first().text())
    .split(";")
    .map((alias) => alias.trim())
    .filter((alias) => alias && alias.toLowerCase() !== title.toLowerCase());

  const seen = new Set<string>();
  const tags: Tag[] = $('.comic-attrs a[href*="genre.php?genre="]')
    .toArray()
    .flatMap((element) => {
      const name = cleanText($(element).text());
      const id = sanitizeId(name);
      if (!name || !id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, title: name }];
    });

  const ratingText = ratingFrom($(".section-status .row.align-center .text.grey.normal").text());
  const rating = ratingText ? Math.min(1, Math.max(0, parseFloat(ratingText) / 5)) : undefined;

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles,
      thumbnailUrl,
      synopsis,
      author: author || undefined,
      status: status || undefined,
      rating,
      contentRating: contentRatingForGenres(tags.map((tag) => tag.title)),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      shareUrl: `${getBaseUrl()}/${mangaId}`,
    },
  };
};

export const parseChapterList = (html: string, sourceManga: SourceManga): Chapter[] => {
  const $ = cheerio.load(html);

  // Each chapter is an anchor to /<slug>/<id> with its number in a child span.
  const entries = $(".chapters-container a[href]")
    .toArray()
    .flatMap((element) => {
      const chapterId = chapterIdFromHref($(element).attr("href"));
      return chapterId ? [{ chapterId, label: cleanText($(element).text()) }] : [];
    });

  const seen = new Set<string>();
  const total = entries.length;
  const chapters = entries.flatMap((entry, index) => {
    if (seen.has(entry.chapterId)) return [];
    seen.add(entry.chapterId);
    const chapNum = chapterNumberFrom(entry.label) ?? total - index;
    return [
      {
        chapterId: entry.chapterId,
        sourceManga,
        langCode: "en",
        chapNum,
        volume: 0,
        sortingIndex: total - index,
      },
    ];
  });

  if (chapters.length === 0) {
    throw new Error(`No chapters found for ${sourceManga.mangaId}`);
  }
  return chapters;
};

export const parseReaderPages = (html: string, chapter: Chapter): ChapterDetails => {
  const $ = cheerio.load(html);

  const pages = $(".reading-container img")
    .toArray()
    .map((element) => absoluteUrl($(element).attr("data-src") ?? $(element).attr("src") ?? ""))
    .filter((url) => url.length > 0);

  if (pages.length === 0) {
    throw new Error(`No pages found for chapter ${chapter.chapterId}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages: [...new Set(pages)],
  };
};
