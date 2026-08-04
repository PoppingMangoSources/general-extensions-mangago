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
import { HOME_TITLES, MATURE_GENRES, type MangaCard } from "./models";

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

// Manga links are /<slug>; chapter links are /<slug>/<chapterId>. The slug is
// the manga id, the trailing number is the chapter id.
const slugFromHref = (href: string | undefined): string =>
  (href ?? "").replace(/^\//, "").split(/[/?#]/)[0] ?? "";

const chapterIdFromHref = (href: string | undefined): string | undefined =>
  /\/([0-9]+)\/?(?:[?#]|$)/.exec(href ?? "")?.[1];

const ratingFrom = (text: string): string | undefined => {
  const value = /[\d.]+/.exec(text)?.[0];
  return value && parseFloat(value) > 0 ? value : undefined;
};

// Views arrive as a raw count; compress to the shortest label that still reads
// (1.4K, 3.1M) so it fits on a carousel card.
const formatCount = (text: string): string | undefined => {
  const count = Number(text.replace(/[^\d]/g, ""));
  if (!count) return undefined;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
};

const chapterNumberFrom = (value: string): number | undefined => {
  const match = /(\d+(?:\.\d+)?)/.exec(value);
  return match ? parseFloat(match[1]) : undefined;
};

// Update labels are relative ("13 hours 49 mins ago", "7 days ago"); sum the
// units back from now and clamp anything ahead of the clock.
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

// The compact carousel card (Popular Now, Most Popular, Completed Romance) — a
// cover with a rating badge, a title, and either a chapter link or a view count.
const parseCarouselCard = (item: cheerio.Cheerio<AnyNode>): MangaCard | undefined => {
  const slug = slugFromHref(item.find("a.manga-cover-link").first().attr("href"));
  const title = cleanText(item.find("a.manga-title-link").first().text());
  if (!slug || !title) return undefined;

  const chapterLink = item.find("a.manga-chapter-link").first();
  const chapterLabel = cleanText(chapterLink.text());

  return {
    slug,
    title,
    cover: coverFrom(item.find(".manga-live-cover").first()),
    rating: ratingFrom(item.find(".manga-live-badge").first().text()),
    views: formatCount(item.find("i.fa-eye").parent().text()),
    chapterId: chapterIdFromHref(chapterLink.attr("href")),
    chapterLabel: chapterLabel || undefined,
    genres: [],
  };
};

// Locate a home section by its heading text, then read every card under it.
const homeSectionCards = (
  $: cheerio.CheerioAPI,
  title: string,
  itemSelector: string,
  parse: (item: cheerio.Cheerio<AnyNode>) => MangaCard | undefined,
): MangaCard[] => {
  const container = $(".section-title")
    .filter((_, element) => cleanText($(element).text()) === title)
    .first()
    .closest(".section-container");

  return container
    .find(itemSelector)
    .toArray()
    .flatMap((element) => {
      const card = parse($(element));
      return card ? [card] : [];
    });
};

export const parseCarouselSection = ($: cheerio.CheerioAPI, title: string): MangaCard[] =>
  homeSectionCards($, title, ".manga-item.manga-live-card", parseCarouselCard);

// The Latest Chapter block is a horizontal grid whose cards carry a numeric
// rating, the newest chapter, and a relative timestamp.
export const parseLatestSection = ($: cheerio.CheerioAPI): MangaCard[] =>
  homeSectionCards($, HOME_TITLES.LATEST, ".manga-horizontal-item", (item) => {
    const slug = slugFromHref(item.find("a.manga-cover-link").first().attr("href"));
    const title = cleanText(item.find("a.manga-title-link").first().text());
    if (!slug || !title) return undefined;

    // Each card lists newest-first chapter rows; the first row with a chapter
    // link is the latest update (other .row.align-center rows hold the rating).
    const chapterRow = item.find(".row.align-center:has(a.episode)").first();
    const chapterLink = chapterRow.find("a.episode").first();

    return {
      slug,
      title,
      cover: coverFrom(item.find(".manga-live-cover").first()),
      rating: ratingFrom(item.find(".row.align-center > span").first().text()),
      chapterId: chapterIdFromHref(chapterLink.attr("href")),
      chapterLabel: cleanText(chapterLink.text()) || undefined,
      updatedAt: cleanText(chapterRow.find(".episode-date").first().text()) || undefined,
      genres: item
        .find('a[href*="genre.php"]')
        .toArray()
        .map((genre) => cleanText($(genre).text()))
        .filter(Boolean),
    };
  });

// Listing pages (weekly, genre, search) drop the carousel's helper classes and
// lay each card out as bare anchors: a cover link, a title link, then a chapter
// link (/<slug>/<id>). Links are told apart by their href shape.
const parseListingCard = (
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<AnyNode>,
): MangaCard | undefined => {
  const links = item
    .find("a[href]")
    .toArray()
    .map((element) => $(element));
  const slugOnly = links.filter((link) => /^\/[^/]+\/?$/.test(link.attr("href") ?? ""));
  const chapterLink = links.find((link) => /^\/[^/]+\/\d+/.test(link.attr("href") ?? ""));

  const slug = slugFromHref((slugOnly[0] ?? links[0])?.attr("href"));
  const title = cleanText(slugOnly.find((link) => link.find("img").length === 0)?.text() ?? "");
  if (!slug || !title) return undefined;

  return {
    slug,
    title,
    cover: coverFrom(item),
    rating: ratingFrom(item.find(".row.align-center span").last().text()),
    views: formatCount(item.find("i.fa-eye").parent().text()),
    chapterId: chapterIdFromHref(chapterLink?.attr("href")),
    chapterLabel: chapterLink ? cleanText(chapterLink.text()) || undefined : undefined,
    genres: [],
  };
};

export const parseListingCards = (html: string): MangaCard[] => {
  const $ = cheerio.load(html);
  return $(".manga-item")
    .toArray()
    .flatMap((element) => {
      const card = parseListingCard($, $(element));
      return card ? [card] : [];
    });
};

const featuredItem = (card: MangaCard): FeaturedCarouselItem => {
  const rating = card.rating ? { symbol: "star.fill" as const, text: card.rating } : undefined;
  const views = card.views ? { symbol: "eye.fill" as const, text: card.views } : undefined;
  const infoItems = [rating, views].filter((item) => item !== undefined);

  return {
    type: "featuredCarouselItem",
    mangaId: card.slug,
    imageUrl: card.cover,
    title: card.title,
    supertitle: card.genres[0],
    infoItems: (infoItems.length > 0 ? infoItems : undefined) as FeaturedCarouselItem["infoItems"],
    contentRating: contentRatingForGenres(card.genres),
  };
};

export const toFeaturedItems = (cards: MangaCard[]): DiscoverSectionItem[] =>
  cards.map(featuredItem);

// Ch. label + rating for the compact carousels (Popular Now, Completed Romance).
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

// Weekly cards show only the chapter number.
export const toWeeklyItems = (cards: MangaCard[]): DiscoverSectionItem[] =>
  cards.map((card) => {
    const chapNum = card.chapterLabel ? chapterNumberFrom(card.chapterLabel) : undefined;
    return {
      type: "simpleCarouselItem",
      mangaId: card.slug,
      imageUrl: card.cover,
      title: card.title,
      subtitle: chapNum !== undefined ? `Ch. ${chapNum}` : undefined,
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

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const $ = cheerio.load(html);

  const title =
    cleanText($('meta[property="og:title"]').attr("content") ?? "") ||
    cleanText($("h1").first().text());
  if (!title) {
    throw new Error(`No details found for ${mangaId}`);
  }

  const thumbnailUrl = absoluteUrl(
    $('meta[property="og:image"]').attr("content") ?? coverFrom($(".manga-live-cover").first()),
  );
  const synopsis = cleanText(
    $(".manga-description").first().text() ||
      $('meta[property="og:description"]').attr("content") ||
      "",
  );

  const seen = new Set<string>();
  const tags: Tag[] = $('a[href*="genre.php?genre="]')
    .toArray()
    .flatMap((element) => {
      const name = cleanText($(element).text());
      const id = sanitizeId(name);
      if (!name || !id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, title: name }];
    });

  const ratingText = ratingFrom($(".manga-live-badge, .rating").first().text());
  const rating = ratingText ? Math.min(1, Math.max(0, parseFloat(ratingText) / 5)) : undefined;

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl,
      synopsis,
      rating,
      contentRating: contentRatingForGenres(tags.map((tag) => tag.title)),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      shareUrl: `${getBaseUrl()}/${mangaId}`,
    },
  };
};

export const parseChapterList = (html: string, sourceManga: SourceManga): Chapter[] => {
  const $ = cheerio.load(html);
  const slug = sourceManga.mangaId;

  // The chapter selector lists every chapter as <option value="<id>"><number>>;
  // reader links (/<slug>/<id>) are the fallback when the select isn't present.
  const options = $("select.chapters-dropdown, select#top_chapter_selection")
    .first()
    .find("option")
    .toArray()
    .flatMap((element) => {
      const chapterId = cleanText($(element).attr("value") ?? "").replace(/[?#].*$/, "");
      return chapterId ? [{ chapterId, label: cleanText($(element).text()) }] : [];
    });

  const entries =
    options.length > 0
      ? options
      : $(`a[href*="/${slug}/"]`)
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
