/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { getBaseUrl } from "./forms";
import { ADULT_GENRES, type JinxCard } from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_ID_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

// Slugs double as ids; unusual characters are percent-encoded so the original
// slug can always be recovered for request URLs. Characters the encoder leaves
// unchanged still fall back to a dash so the id always lands in the safe set.
export const encodeSlugId = (slug: string): string =>
  slug.replace(SAFE_ID_REGEX, (char) => {
    const encoded = encodeURIComponent(char);
    return encoded !== char ? encoded : "-";
  });

export const decodeSlugId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();

// Card links arrive as /manga/{id-slug} or manga/{id-slug}; keep only the slug.
const mangaSlugFromUrl = (url: string): string | undefined =>
  /(?:^|\/)manga\/([^/?#]+)/.exec(url)?.[1];

const absoluteUrl = (url: string): string => {
  if (url.startsWith("http")) return url;
  return `${getBaseUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
};

export const contentRatingForGenres = (genres: string[], isAdult = false): ContentRating => {
  if (isAdult) return ContentRating.ADULT;
  const normalized = genres.map((genre) => genre.trim().toLowerCase());
  return normalized.some((genre) => ADULT_GENRES.includes(genre))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
};

const chapterNumberFrom = (value: string): number | undefined => {
  const match = /chapter[.\s-]*(\d+(?:\.\d+)?)/i.exec(value);
  return match ? parseFloat(match[1]) : undefined;
};

// Site timestamps are zoneless and mostly relative ("2 hours ago"); parse both
// forms as UTC and clamp anything ahead of the clock so ages never go negative.
const parseSiteDate = (value: string): Date | undefined => {
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (text === "just now" || text.includes("less than")) return new Date();

  if (text.includes("ago")) {
    const count = Number(/\d+/.exec(text)?.[0] ?? 0);
    const unit = [
      ["second", 1_000],
      ["minute", 60_000],
      ["hour", 3_600_000],
      ["day", 86_400_000],
      ["week", 604_800_000],
      ["month", 2_629_800_000],
      ["year", 31_557_600_000],
    ].find(([name]) => text.includes(String(name)))?.[1];
    if (typeof unit === "number") return new Date(Date.now() - count * unit);
    return undefined;
  }

  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ t](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  const date = ymd
    ? new Date(
        Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3], +(ymd[4] ?? 0), +(ymd[5] ?? 0), +(ymd[6] ?? 0)),
      )
    : new Date(value);

  if (Number.isNaN(date.getTime())) return undefined;
  return date.getTime() > Date.now() ? new Date() : date;
};

const coverFrom = (element: cheerio.Cheerio<AnyNode>): string => {
  const img = element.find("img").first();
  const source = img.attr("data-src") ?? img.attr("src") ?? "";
  return source && !source.includes("/static/") ? absoluteUrl(source) : "";
};

interface EmbeddedData {
  name?: string;
  url?: string;
  cover?: string;
  rating?: string;
  views?: string;
  summary?: string;
  updated_at?: string;
  is_adult?: number;
  genres?: { name?: string }[];
}

const embeddedData = (item: cheerio.Cheerio<AnyNode>): EmbeddedData | undefined => {
  const raw = item.find("script#json-data").first().text().trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as EmbeddedData;
  } catch {
    return undefined;
  }
};

// Listing pages render one of two card shapes. The compact grid card embeds a
// JSON block carrying the summary, views and rating that the markup itself
// leaves out, so it is preferred whenever present.
const cardFrom = ($: cheerio.CheerioAPI, element: AnyNode): JinxCard | undefined => {
  const item = $(element);
  const data = embeddedData(item);

  const link = item.find(".title a, h3 a, h4 a, a").first();
  const url = data?.url ?? link.attr("href") ?? "";
  if (!mangaSlugFromUrl(url)) return undefined;

  const title = cleanText(data?.name ?? item.find(".title, .name, h3, h4").first().text());
  if (!title) return undefined;

  const chapterLink = item.find('a[href*="chapter"]').first();
  const markupGenres = item
    .find(".genres span, .genres a")
    .toArray()
    .map((genre) => cleanText($(genre).text()))
    .filter(Boolean);

  return {
    url,
    title,
    cover: data?.cover ? absoluteUrl(data.cover) : coverFrom(item),
    latestChapter:
      cleanText(item.find(".latest-chapter").first().text()) ||
      cleanText(chapterLink.text()) ||
      undefined,
    latestChapterUrl: chapterLink.attr("href") ?? undefined,
    views: cleanText(data?.views ?? item.find(".views span, .views").first().text()) || undefined,
    rating:
      (data?.rating ?? cleanText(item.find(".rating .score, .rating").first().text())).replace(
        /[^\d.]/g,
        "",
      ) || undefined,
    genres: (data?.genres ?? []).map((genre) => genre.name ?? "").filter(Boolean).length
      ? (data?.genres ?? []).map((genre) => genre.name ?? "").filter(Boolean)
      : markupGenres,
    summary: cleanText(data?.summary ?? item.find(".summary p, .summary").first().text()),
    updatedAt: data?.updated_at,
    isAdult: data?.is_adult === 1,
  };
};

// Both listing layouts are collected in one pass so a page that uses the
// detailed card and one that uses the grid card parse the same way.
export const parseCards = (html: string): JinxCard[] => {
  const $ = cheerio.load(html);
  const cards: JinxCard[] = [];
  const seen = new Set<string>();

  for (const element of $(".book-detailed-item, .book-item").toArray()) {
    const card = cardFrom($, element);
    const slug = card ? mangaSlugFromUrl(card.url) : undefined;
    if (!card || !slug || seen.has(slug)) continue;
    seen.add(slug);
    cards.push(card);
  }

  return cards;
};

// The homepage hot carousel uses compact trending cells with no metadata block.
export const parseHotCells = (html: string): JinxCard[] => {
  const $ = cheerio.load(html);
  const cards: JinxCard[] = [];
  const seen = new Set<string>();

  for (const element of $(".trending-item").toArray()) {
    const item = $(element);
    const url = item.find("a").first().attr("href") ?? "";
    const slug = mangaSlugFromUrl(url);
    if (!slug || seen.has(slug)) continue;

    const title = cleanText(
      item.find(".name").first().text() || item.find("a").first().attr("title") || "",
    );
    if (!title) continue;

    seen.add(slug);
    cards.push({
      url,
      title,
      cover: coverFrom(item),
      latestChapter: cleanText(item.find(".latest-chapter").first().text()) || undefined,
      genres: [],
    });
  }

  return cards;
};

const ratingText = (card: JinxCard): string | undefined => {
  const value = card.rating ? parseFloat(card.rating) : NaN;
  return Number.isFinite(value) && value > 0 ? value.toFixed(1) : undefined;
};

export const toFeaturedItems = (cards: JinxCard[]): DiscoverSectionItem[] =>
  cards.flatMap((card) => {
    const slug = mangaSlugFromUrl(card.url);
    if (!slug) return [];

    const rating = ratingText(card);
    const score = rating ? { symbol: "star.fill" as const, text: rating } : undefined;
    const views = card.views ? { symbol: "eye.fill" as const, text: card.views } : undefined;

    return [
      {
        type: "featuredCarouselItem",
        mangaId: encodeSlugId(slug),
        imageUrl: card.cover,
        title: card.title,
        supertitle: card.genres.length > 0 ? card.genres.join(", ") : undefined,
        summary: card.summary || undefined,
        // The carousel takes at most two info pills.
        infoItems: score && views ? [score, views] : score ? [score] : views ? [views] : undefined,
        contentRating: contentRatingForGenres(card.genres, card.isAdult),
      },
    ];
  });

// `detail` picks what the subtitle leads with: the newest chapter, the view
// count, or the score, matching what the section is ranked by.
export const toRankedItems = (
  cards: JinxCard[],
  detail: "chapter" | "views" | "rating",
  ranked = true,
): DiscoverSectionItem[] =>
  cards.flatMap((card, index) => {
    const slug = mangaSlugFromUrl(card.url);
    if (!slug) return [];

    const rating = ratingText(card);
    const lead =
      detail === "chapter"
        ? card.latestChapter
        : detail === "views"
          ? card.views && `${card.views} views`
          : rating && `${rating} ★`;
    const subtitle = [ranked ? `#${index + 1}` : undefined, lead].filter(Boolean).join(" • ");

    return [
      {
        type: "simpleCarouselItem",
        mangaId: encodeSlugId(slug),
        imageUrl: card.cover,
        title: card.title,
        subtitle: subtitle || undefined,
        contentRating: contentRatingForGenres(card.genres, card.isAdult),
      },
    ];
  });

export const toLatestItems = (cards: JinxCard[]): DiscoverSectionItem[] =>
  cards.flatMap((card) => {
    const slug = mangaSlugFromUrl(card.url);
    if (!slug) return [];

    const chapNum = card.latestChapter ? chapterNumberFrom(card.latestChapter) : undefined;
    // Reader URLs follow the chapter-{n} shape, so the label is enough to
    // address the chapter even when the card carries no direct link.
    const chapterSlug = card.latestChapterUrl
      ? (card.latestChapterUrl.split("/").pop() ?? "").replace(/[?#].*$/, "")
      : chapNum !== undefined
        ? `chapter-${chapNum}`
        : undefined;
    if (!chapterSlug) return [];

    const rating = ratingText(card);
    const subtitle = [
      chapNum !== undefined ? `Ch. ${chapNum}` : card.latestChapter,
      rating ? `${rating} ★` : undefined,
    ]
      .filter(Boolean)
      .join(" • ");

    return [
      {
        type: "chapterUpdatesCarouselItem",
        mangaId: encodeSlugId(slug),
        chapterId: encodeSlugId(chapterSlug),
        imageUrl: card.cover,
        title: card.title,
        subtitle: subtitle || undefined,
        publishDate: card.updatedAt ? parseSiteDate(card.updatedAt) : undefined,
        contentRating: contentRatingForGenres(card.genres, card.isAdult),
      },
    ];
  });

export const toSearchResultItems = (cards: JinxCard[]): SearchResultItem[] =>
  cards.flatMap((card) => {
    const slug = mangaSlugFromUrl(card.url);
    if (!slug) return [];

    const rating = ratingText(card);
    const subtitle = [rating ? `${rating} ★` : undefined, card.genres[0]]
      .filter(Boolean)
      .join(" • ");

    return [
      {
        mangaId: encodeSlugId(slug),
        title: card.title,
        imageUrl: card.cover,
        subtitle: subtitle || undefined,
        contentRating: contentRatingForGenres(card.genres, card.isAdult),
      },
    ];
  });

export const hasNextPage = (html: string): boolean => {
  const $ = cheerio.load(html);
  return $(".paginator > a.active + a:not([rel=next]), .pagination a[rel=next]").length > 0;
};

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const $ = cheerio.load(html);

  const title = cleanText($(".detail h1, .name h1").first().text());
  if (!title) {
    throw new Error(`No details found for ${mangaId}`);
  }

  const authors = $('.detail .meta > p > strong:contains("Authors") ~ a')
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  const genres = $('.detail .meta > p > strong:contains("Genres") ~ a')
    .toArray()
    .map((element) =>
      cleanText(
        $(element)
          .text()
          .replace(/[,\s]+$/, ""),
      ),
    )
    .filter(Boolean);
  const statusText = cleanText(
    $('.detail .meta > p > strong:contains("Status") ~ a').first().text(),
  );

  // The inline cover is a lazy-loading placeholder; the share image carries
  // the real full-size cover.
  const cover = $("#cover img").first();
  const thumbnailUrl =
    $('meta[property="og:image"]').attr("content") ??
    cover.attr("data-src") ??
    cover.attr("src") ??
    "";

  // The first summary paragraph is boilerplate about the site; the story
  // description follows it.
  const summary = $(".summary p, .summary .content")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter((text) => text && !/^you are reading\b/i.test(text))
    .join("\n\n");

  const secondaryTitles = cleanText($(".detail h2, .name h2").first().text())
    .split(/[,;]/)
    .map((alias) => alias.trim())
    .filter((alias) => alias && alias.toLowerCase() !== title.toLowerCase());

  const seen = new Set<string>();
  const tags: Tag[] = genres.flatMap((genre) => {
    const id = sanitizeId(genre);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, title: genre }];
  });

  const score = cleanText($(".rating .score, #score-board").first().text()).replace(/[^\d.]/g, "");
  const rating =
    score && parseFloat(score) > 0 ? Math.min(1, Math.max(0, parseFloat(score) / 5)) : undefined;

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles,
      thumbnailUrl: thumbnailUrl ? absoluteUrl(thumbnailUrl) : "",
      synopsis: summary,
      author: authors.join(", ") || undefined,
      status: statusText ? statusText.charAt(0).toUpperCase() + statusText.slice(1) : undefined,
      rating: Number.isFinite(rating) ? rating : undefined,
      contentRating: contentRatingForGenres(genres),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      shareUrl: `${getBaseUrl()}/manga/${decodeSlugId(mangaId)}`,
    },
  };
};

export const parseChapterList = (html: string, sourceManga: SourceManga): Chapter[] => {
  const $ = cheerio.load(html);
  const rows = $("#chapter-list > li, .chapter-list > li").toArray();

  const chapters = rows.flatMap((element, index) => {
    const row = $(element);
    const url = row.find("a").first().attr("href") ?? "";
    const chapterId = url
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[?#].*$/, "");
    if (!chapterId) return [];

    const name = cleanText(row.find(".chapter-title").first().text());
    const chapNum = chapterNumberFrom(name) ?? chapterNumberFrom(chapterId) ?? rows.length - index;
    const dateText = cleanText(row.find(".chapter-update").first().text());

    return [
      {
        chapterId: encodeSlugId(chapterId),
        sourceManga,
        langCode: "en",
        chapNum,
        title: name && !/^chapter[.\s-]*[\d.]+$/i.test(name) ? name : undefined,
        volume: 0,
        sortingIndex: rows.length - index,
        publishDate: dateText ? parseSiteDate(dateText) : undefined,
      },
    ];
  });

  if (chapters.length === 0) {
    throw new Error(`No chapters found for ${sourceManga.mangaId}`);
  }
  return chapters;
};

export const parseChapterPages = (html: string, chapter: Chapter): ChapterDetails => {
  const $ = cheerio.load(html);

  // The reader injects its images from a script variable, so the container is
  // empty on first load; the markup pass only pays off on the pre-rendered
  // pages some chapters still ship.
  let pages = $("#chapter-images img, .chapter-image img, .chapter-lazy-image")
    .toArray()
    .map((element) => {
      const image = $(element);
      return (
        image.attr("data-src") ??
        image.attr("data-lazy-src") ??
        image.attr("data-cfsrc") ??
        image.attr("src") ??
        ""
      );
    })
    .filter((url) => url.length > 0 && !url.includes("/static/"));

  if (pages.length === 0) {
    const list = /var\s+chapImages\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1];
    if (list) {
      const server = /var\s+mainServer\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1] ?? "";
      pages = list
        .split(",")
        .map((path) => path.trim())
        .filter(Boolean)
        .map((path) => {
          if (path.startsWith("http")) return path;
          const prefix = server.startsWith("//") ? `https:${server}` : server;
          return `${prefix}${path}`;
        });
    }
  }

  // Signed CDN queries must keep their ampersands intact; re-encoded entities
  // break the signature and the CDN answers 403.
  pages = pages.map((url) => Application.decodeHTMLEntities(url).replace(/ /g, "%20"));

  if (pages.length === 0) {
    throw new Error(`No pages found for chapter ${chapter.chapterId}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages: [...new Set(pages)],
  };
};
