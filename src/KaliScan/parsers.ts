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

import { getBaseUrl } from "./forms";
import { ADULT_GENRES, type KaliCard } from "./models";

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
export const mangaSlugFromUrl = (url: string): string | undefined =>
  /(?:^|\/)manga\/([^/?#]+)/.exec(url)?.[1];

const absoluteUrl = (url: string): string => {
  if (url.startsWith("http")) return url;
  return `${getBaseUrl()}${url.startsWith("/") ? "" : "/"}${url}`;
};

export const contentRatingForGenres = (genres: string[]): ContentRating => {
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
export const parseSiteDate = (value: string): Date | undefined => {
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

const coverFrom = ($: cheerio.CheerioAPI, element: cheerio.Cheerio<never>): string => {
  const img = element.find("img").first();
  const source = img.attr("data-src") ?? img.attr("src") ?? "";
  return source && !source.includes("/static/") ? absoluteUrl(source) : "";
};

// The detailed cards on /top/* and /search share one layout.
export const parseDetailedCards = (html: string): KaliCard[] => {
  const $ = cheerio.load(html);
  const cards: KaliCard[] = [];

  $(".book-detailed-item").each((_, element) => {
    const item = $(element);
    const link = item.find(".title a, h3 a").first();
    const url = link.attr("href") ?? "";
    if (!mangaSlugFromUrl(url)) return;

    cards.push({
      url,
      title: cleanText(link.text()),
      cover: coverFrom($, item as cheerio.Cheerio<never>),
      latestChapter: cleanText(item.find(".latest-chapter").first().text()) || undefined,
      views: cleanText(item.find(".views span").first().text()) || undefined,
      rating:
        cleanText(item.find(".rating .score").first().text()).replace(/[^\d.]/g, "") || undefined,
      genres: item
        .find(".genres span")
        .toArray()
        .map((genre) => cleanText($(genre).text()))
        .filter(Boolean),
      summary: cleanText(item.find(".summary p").first().text()) || undefined,
    });
  });

  return cards;
};

// The homepage hot carousel uses compact trending cells.
export const parseHotCells = (html: string): KaliCard[] => {
  const $ = cheerio.load(html);
  const cards: KaliCard[] = [];

  $(".trending-item").each((_, element) => {
    const item = $(element);
    const url = item.find("a").first().attr("href") ?? "";
    if (!mangaSlugFromUrl(url)) return;

    cards.push({
      url,
      title: cleanText(item.find(".name").first().text()),
      cover: coverFrom($, item as cheerio.Cheerio<never>),
      latestChapter: cleanText(item.find(".latest-chapter").first().text()) || undefined,
      genres: [],
    });
  });

  return cards;
};

const featuredItem = (card: KaliCard): DiscoverSectionItem | undefined => {
  const slug = mangaSlugFromUrl(card.url);
  if (!slug || !card.title) return undefined;

  const ratingInfo = card.rating ? { symbol: "star.fill" as const, text: card.rating } : undefined;
  const viewsInfo = card.views ? { symbol: "eye.fill" as const, text: card.views } : undefined;

  return {
    type: "featuredCarouselItem",
    mangaId: encodeSlugId(slug),
    imageUrl: card.cover,
    title: card.title,
    supertitle: card.genres.length > 0 ? card.genres.join(", ") : undefined,
    summary: card.summary,
    infoItems:
      ratingInfo && viewsInfo
        ? [ratingInfo, viewsInfo]
        : ratingInfo
          ? [ratingInfo]
          : viewsInfo
            ? [viewsInfo]
            : undefined,
    contentRating: contentRatingForGenres(card.genres),
  };
};

export const toFeaturedItems = (cards: KaliCard[]): DiscoverSectionItem[] =>
  cards
    .map((card) => featuredItem(card))
    .filter((item): item is DiscoverSectionItem => Boolean(item));

export const toRankedCardItems = (
  cards: KaliCard[],
  detail: "views" | "chapter",
): DiscoverSectionItem[] =>
  cards.flatMap((card, index) => {
    const slug = mangaSlugFromUrl(card.url);
    if (!slug || !card.title) return [];

    const lead =
      detail === "views" ? (card.views ? `${card.views} views` : undefined) : card.latestChapter;
    const subtitle = [`#${index + 1}`, lead].filter(Boolean).join(" • ");

    return [
      {
        type: "simpleCarouselItem",
        mangaId: encodeSlugId(slug),
        imageUrl: card.cover,
        title: card.title,
        subtitle,
        contentRating: contentRatingForGenres(card.genres),
      },
    ];
  });

// The latest listing labels each series with its newest chapter; reader URLs
// follow the same chapter-{n} shape, so the id is derived from that label.
export const toLatestItems = (cards: KaliCard[]): DiscoverSectionItem[] =>
  cards.flatMap((card) => {
    const slug = mangaSlugFromUrl(card.url);
    const chapNum = card.latestChapter ? chapterNumberFrom(card.latestChapter) : undefined;
    if (!slug || !card.title || chapNum === undefined) return [];

    const rating = card.rating && parseFloat(card.rating) > 0 ? card.rating : undefined;
    const subtitle = [`Ch. ${chapNum}`, rating ? `★ ${parseFloat(rating).toFixed(1)}` : undefined]
      .filter(Boolean)
      .join(" • ");

    return [
      {
        type: "chapterUpdatesCarouselItem",
        mangaId: encodeSlugId(slug),
        chapterId: `chapter-${chapNum}`,
        imageUrl: card.cover,
        title: card.title,
        subtitle: subtitle || undefined,
        contentRating: contentRatingForGenres(card.genres),
      },
    ];
  });

export const toSearchResultItems = (cards: KaliCard[]): SearchResultItem[] =>
  cards.flatMap((card) => {
    const slug = mangaSlugFromUrl(card.url);
    if (!slug || !card.title) return [];
    const subtitle = [card.rating ? `★ ${card.rating}` : undefined, card.genres[0]]
      .filter(Boolean)
      .join(" • ");

    return [
      {
        mangaId: encodeSlugId(slug),
        title: card.title,
        imageUrl: card.cover,
        subtitle: subtitle || undefined,
        contentRating: contentRatingForGenres(card.genres),
      },
    ];
  });

export const hasNextPage = (html: string): boolean => {
  const $ = cheerio.load(html);
  return $(".paginator > a.active + a:not([rel=next])").length > 0;
};

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const $ = cheerio.load(html);

  const title = cleanText($(".detail h1").first().text());
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

  const cover = $("#cover img").first();
  const thumbnailUrl = cover.attr("data-src") ?? cover.attr("src") ?? "";

  let summary = $(".summary .content, .summary .content ~ p")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean)
    .join("\n\n");
  if (!summary) {
    summary = cleanText($(".summary").first().text()).replace(/^summary\s*/i, "");
  }
  if (!summary) {
    summary = cleanText($('meta[name="description"]').attr("content") ?? "");
  }

  const secondaryTitles = cleanText($(".detail h2").first().text())
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

  const ratingText = cleanText($(".rating .score").first().text()).replace(/[^\d.]/g, "");
  const rating =
    ratingText && parseFloat(ratingText) > 0
      ? Math.min(1, Math.max(0, parseFloat(ratingText) / 5))
      : undefined;

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
  const rows = $("#chapter-list > li").toArray();

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

  let pages = $("#chapter-images img, .chapter-image")
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
    const script = /var\s+chapImages\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1];
    if (script) {
      const server = /var\s+mainServer\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1] ?? "";
      pages = script
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
