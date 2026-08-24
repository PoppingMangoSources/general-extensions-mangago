/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterUpdatesCarouselItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SimpleCarouselItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";
import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { DOMAIN, type ListingChapter, type MangaListItem, type ReaderMetadata } from "./models";
import { mangaUrl } from "./network";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const ADULT_GENRES = new Set(["adult", "hentai", "lolicon", "shotacon"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "smut", "yaoi", "yuri"]);
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const cleanText = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const cleanDescription = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const sanitizeId = (value: string): string => value.replace(SAFE_ID_REGEX, "-");

export const parseMangaId = (value?: string | null): string =>
  sanitizeId((value ?? "").match(/\/manga\/([^/?#]+)/i)?.[1] ?? "");

const parseChapterRef = (
  value?: string | null,
): { mangaId: string; chapterId: string } | undefined => {
  const match = (value ?? "").match(/\/manga\/([^/?#]+)\/((?:v[^/]+\/)?c[^/?#]+)/i);
  if (!match) return undefined;
  return { mangaId: sanitizeId(match[1]), chapterId: sanitizeId(match[2]) };
};

const toAbsoluteUrl = (value?: string | null): string => {
  const url = Application.decodeHTMLEntities(value ?? "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>): string =>
  toAbsoluteUrl(
    image.attr("data-src") ??
      image.attr("data-lazy-src") ??
      image.attr("data-cfsrc") ??
      image.attr("src"),
  );

export const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const parseChapterNumber = (value: string): number | undefined => {
  const match = value.match(/Ch(?:apter)?\.?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number.parseFloat(match[1]) : undefined;
};

const parseVolumeNumber = (value: string): number | undefined => {
  const match = value.match(/Vol(?:ume)?\.?\s*(\d+(?:\.\d+)?)/i);
  return match ? Number.parseFloat(match[1]) : undefined;
};

export const parseSiteDate = (value?: string | null): Date | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;
  const relative = text.match(/(\d+)\s*(minute|hour|day|week)s?\s*ago/i);
  if (relative) {
    const date = new Date();
    const amount = Number.parseInt(relative[1], 10);
    const multipliers: Record<string, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
    };
    date.setTime(date.getTime() - amount * multipliers[relative[2].toLowerCase()]);
    return date;
  }
  if (/today/i.test(text)) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }
  if (/yesterday/i.test(text)) {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }
  const match = text.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return undefined;
  const month = MONTHS[match[1].toLowerCase()];
  if (month == null) return undefined;
  return new Date(Number.parseInt(match[3], 10), month, Number.parseInt(match[2], 10));
};

const labeledValue = (
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<AnyNode>,
  label: string,
): string => {
  let result = "";
  item.find(".manga-list-hover-info-line").each((_, element) => {
    if (result) return;
    const row = $(element);
    if (!cleanText(row.find(".manga-list-hover-info-t").first().text()).startsWith(label)) return;
    result = cleanText(row.clone().children().first().remove().end().text());
  });
  return result;
};

const parseListItem = (
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<AnyNode>,
): MangaListItem | undefined => {
  const titleLink = item
    .find(
      ".manga-list-1-item-title a, .manga-list-2-item-title a, .manga-list-2-title a, .manga-list-3-show-title a, .manga-list-4-item-title a",
    )
    .first();
  const coverLink = item.find('a[href*="/manga/"][title]').first();
  const mangaId = parseMangaId(titleLink.attr("href") ?? coverLink.attr("href"));
  const title = cleanText(
    titleLink.attr("title") ?? coverLink.attr("title") ?? titleLink.text() ?? coverLink.text(),
  );
  if (!mangaId || !title) return undefined;

  const genres = [
    ...new Set(
      item
        .find(
          ".manga-list-hover-info-block .item-tag, .manga-list-3-show-tag-list span, .manga-list-4-show-tag-list a",
        )
        .toArray()
        .map((element) => cleanText($(element).text()))
        .filter((genre) => genre.length > 0),
    ),
  ];

  const ratingText = cleanText(item.find(".item-score").first().text());
  const rating = Number.parseFloat(ratingText);
  const chapterLink = item
    .find(
      '.manga-list-1-item-subtitle a, .manga-list-2-item-subtitle a, .manga-list-4-item-part a, .manga-list-4-item-tip a[href*="/c"]',
    )
    .first();
  const chapterRef = parseChapterRef(chapterLink.attr("href"));
  const chapterText = cleanText(chapterLink.text() || chapterLink.attr("title"));
  const chapter: ListingChapter | undefined = chapterRef
    ? {
        chapterId: chapterRef.chapterId,
        label: chapterText,
        chapNum: parseChapterNumber(chapterText) ?? parseChapterNumber(chapterRef.chapterId),
        volume: parseVolumeNumber(chapterText) ?? parseVolumeNumber(chapterRef.chapterId),
      }
    : undefined;

  const rankText =
    cleanText(item.find('[class^="rank-"], [class*=" rank-"]').first().text()) ||
    labeledValue($, item, "Rank:");
  const rank = Number.parseInt(rankText.replace(/\D/g, ""), 10);
  const views = Number.parseInt(labeledValue($, item, "Views:").replace(/\D/g, ""), 10);
  const searchAuthor = item
    .find(".manga-list-4-item-tip")
    .toArray()
    .map((element) => $(element))
    .find((row) => cleanText(row.text()).startsWith("Author:"));
  const author =
    labeledValue($, item, "Author:") ||
    cleanText(item.find(".manga-list-3-show-say a").text()) ||
    cleanText(searchAuthor?.find("a").text());
  const status = cleanText(item.find(".manga-list-4-show-tag-list-2 a").first().text());
  const dateText = cleanText(
    item
      .find(".manga-list-4-item-subtitle span, .manga-list-2-cover-bottom, p.title2")
      .first()
      .text(),
  );

  return {
    mangaId,
    title,
    imageUrl: imageUrlFrom(
      item
        .find(
          "img.manga-list-1-cover, img.manga-list-2-cover-img, img.manga-list-3-show-img, img.manga-list-4-cover",
        )
        .first(),
    ),
    genres,
    rating: Number.isFinite(rating) ? rating : undefined,
    author: author || undefined,
    status: status || undefined,
    views: Number.isFinite(views) ? views : undefined,
    rank: Number.isFinite(rank) && rank > 0 ? rank : undefined,
    chapter,
    updatedAt: parseSiteDate(dateText),
  };
};

const parseElements = ($: cheerio.CheerioAPI, elements: AnyNode[]): MangaListItem[] => {
  const items: MangaListItem[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    const item = parseListItem($, $(element));
    if (!item || seen.has(item.mangaId)) continue;
    seen.add(item.mangaId);
    items.push(item);
  }
  return items;
};

export const parseMangaList = ($: cheerio.CheerioAPI, selector: string): MangaListItem[] =>
  parseElements($, $(selector).toArray());

export const parseHomeSection = ($: cheerio.CheerioAPI, heading: string): MangaListItem[] => {
  const section = $(".manga-list-1, .manga-list-2, .manga-list-3, .manga-list-4")
    .toArray()
    .map((element) => $(element))
    .find((item) => {
      const title = cleanText(
        item
          .children(
            ".manga-list-1-title, .manga-list-2-title, .manga-list-3-title, .manga-list-4-title",
          )
          .first()
          .clone()
          .children()
          .remove()
          .end()
          .text(),
      );
      return (
        title === heading || (heading === "New Manga Release" && title === "New Manga Releases")
      );
    });
  if (!section) return [];
  return parseElements(
    $,
    section.find("> ul > li, > .main-large > ul > li, > .main-small .manga-list-3-show").toArray(),
  );
};

export const parseMobileHomeSection = ($: cheerio.CheerioAPI, heading: string): MangaListItem[] => {
  const section = $(".manga-list")
    .toArray()
    .map((element) => $(element))
    .find((item) => cleanText(item.children(".manga-list-title").first().text()) === heading);
  return section ? parseElements($, section.find("> ul.manga-list-2 > li").toArray()) : [];
};

export const parseRankingList = ($: cheerio.CheerioAPI, className: string): MangaListItem[] =>
  parseMangaList($, `.${className} ul.manga-list-1-list > li`).map((item, index) => ({
    ...item,
    rank: item.rank ?? index + 1,
  }));

export const parseHasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $(".pager-list-left a")
    .toArray()
    .some(
      (element) =>
        cleanText($(element).text()) === ">" &&
        !($(element).attr("href") ?? "").startsWith("javascript"),
    );

const genreSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const info = $(".detail-info");
  const right = info.find(".detail-info-right");
  const title = cleanText(right.find(".detail-info-right-title-font").first().text()) || mangaId;
  const genres = right
    .find(".detail-info-right-tag-list a")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter((genre) => genre.length > 0);
  const author = [
    ...new Set(
      right
        .find(".detail-info-right-say a")
        .toArray()
        .map((element) => cleanText($(element).text()))
        .filter((name) => name.length > 0),
    ),
  ].join(", ");
  const statusText = cleanText(right.find(".detail-info-right-title-tip").first().text());
  const rating = Number.parseFloat(cleanText(right.find(".item-score").first().text()));
  const tagGroups: TagSection[] = [];
  if (genres.length > 0) {
    tagGroups.push({
      id: "genres",
      title: "Genres",
      tags: genres.map((genre) => ({ id: genreSlug(genre), title: genre })),
    });
  }

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl: imageUrlFrom(info.find("img.detail-info-cover-img").first()),
      author: author || undefined,
      synopsis: cleanDescription(right.find(".fullcontent").first().text()),
      contentRating: contentRatingForGenres(genres),
      status: /completed/i.test(statusText)
        ? "Completed"
        : /ongoing/i.test(statusText)
          ? "Ongoing"
          : undefined,
      rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
      tagGroups,
      shareUrl: mangaUrl(mangaId),
    },
  };
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const rows = $("ul.detail-main-list > li").toArray();
  const chapters = rows.flatMap((element, index) => {
    const row = $(element);
    const link = row.find("a").first();
    const ref = parseChapterRef(link.attr("href"));
    if (!ref) return [];
    const label = cleanText(row.find("p.title3").first().text() || link.attr("title"));
    const chapNum = parseChapterNumber(label) ?? parseChapterNumber(ref.chapterId);
    return [
      {
        chapterId: ref.chapterId,
        sourceManga,
        langCode: "en",
        chapNum: chapNum ?? 0,
        title: chapNum == null ? label || undefined : undefined,
        volume: 0,
        publishDate: parseSiteDate(row.find("p.title2").first().text()),
        sortingIndex: rows.length - index,
      },
    ];
  });
  if (chapters.length === 0) {
    throw new Error(`No chapters found for ${sourceManga.mangaId}`);
  }
  return chapters;
};

export const parseReaderMetadata = ($: cheerio.CheerioAPI): ReaderMetadata | undefined => {
  const scripts = $("script:not([src])")
    .toArray()
    .map((element) => $(element).text())
    .join("\n");
  const chapterId = /(?:var\s+)?chapterid\s*=\s*(\d+)/i.exec(scripts)?.[1];
  const imageCount = Number.parseInt(
    /(?:var\s+)?imagecount\s*=\s*(\d+)/i.exec(scripts)?.[1] ?? "",
    10,
  );
  return chapterId && Number.isFinite(imageCount) && imageCount > 0
    ? { chapterId, imageCount }
    : undefined;
};

const formatCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
};

const chapterLabel = (chapter?: ListingChapter): string | undefined => {
  if (!chapter) return undefined;
  return [
    chapter.volume != null ? `Vol.${chapter.volume}` : undefined,
    chapter.chapNum != null ? `Ch.${chapter.chapNum}` : chapter.label || undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
};

export const toFeaturedItem = (item: MangaListItem): FeaturedCarouselItem => {
  const infoItems: { symbol: string; text: string }[] = [];
  if (item.rating != null) infoItems.push({ symbol: "star.fill", text: item.rating.toFixed(2) });
  if (item.views != null) infoItems.push({ symbol: "eye.fill", text: formatCount(item.views) });
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: item.author,
    summary:
      [chapterLabel(item.chapter), item.rank != null ? `Rank ${item.rank}` : undefined]
        .filter((value): value is string => Boolean(value))
        .join(" • ") || undefined,
    infoItems:
      infoItems.length === 0
        ? undefined
        : infoItems.length === 1
          ? [infoItems[0]]
          : [infoItems[0], infoItems[1]],
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toSimpleItem = (item: MangaListItem): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle:
    [chapterLabel(item.chapter), item.rating != null ? `★ ${item.rating.toFixed(2)}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(item.genres),
});

export const toChapterUpdateItem = (
  item: MangaListItem,
): ChapterUpdatesCarouselItem | undefined => {
  if (!item.chapter) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: item.chapter.chapterId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle:
      [chapterLabel(item.chapter), item.rating != null ? `★ ${item.rating.toFixed(2)}` : undefined]
        .filter((value): value is string => Boolean(value))
        .join(" • ") || undefined,
    publishDate: item.updatedAt,
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toSearchResultItem = (
  item: MangaListItem,
  fallbackRating = ContentRating.MATURE,
): SearchResultItem => ({
  mangaId: item.mangaId,
  title: item.title,
  imageUrl: item.imageUrl,
  subtitle:
    [chapterLabel(item.chapter), item.status]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: item.genres.length > 0 ? contentRatingForGenres(item.genres) : fallbackRating,
});

export const toRankingSearchItem = (item: MangaListItem): SearchResultItem => ({
  mangaId: item.mangaId,
  title: item.title,
  imageUrl: item.imageUrl,
  subtitle:
    [
      item.rank != null ? `#${item.rank}` : undefined,
      chapterLabel(item.chapter),
      item.rating != null ? `★ ${item.rating.toFixed(2)}` : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(item.genres),
});
