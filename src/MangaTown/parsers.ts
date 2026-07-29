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

import { DOMAIN, type ListingChapter, type MangaListItem } from "./models";
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
  const match = (value ?? "").match(/\/manga\/([^/?#]+)\/((?:v[^/]+\/)?c[^/?#]+)\/?/i);
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

// Anchor relative dates to midnight so re-parsing the same listing stays stable.
const startOfDay = (daysAgo: number): Date => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const parseSiteDate = (value?: string | null): Date | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/today/i.test(text)) return startOfDay(0);
  if (/yesterday/i.test(text)) return startOfDay(1);
  const match = text.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return undefined;
  const month = MONTHS[match[1].toLowerCase()];
  if (month == null) return undefined;
  return new Date(Number.parseInt(match[3], 10), month, Number.parseInt(match[2], 10));
};

const parseChapterNumber = (value: string): number | undefined => {
  const match = value.match(/(\d+(?:\.\d+)?)\s*$/);
  return match ? Number.parseFloat(match[1]) : undefined;
};

const parseListingChapter = (item: cheerio.Cheerio<AnyNode>): ListingChapter | undefined => {
  const link = item.find("p.new_chapter a").first();
  const ref = parseChapterRef(link.attr("href"));
  if (!ref) return undefined;
  const label = cleanText(link.text());
  return { chapterId: ref.chapterId, label, chapNum: parseChapterNumber(label) };
};

export const parseMangaList = ($: cheerio.CheerioAPI): MangaListItem[] => {
  const items: MangaListItem[] = [];
  const seen = new Set<string>();
  $("li").each((_, element) => {
    const item = $(element);
    const cover = item.find("a.manga_cover").first();
    if (cover.length === 0) return;
    const titleLink = item.find("p.title a").first();
    const fallbackLink = item.find("p a").first();
    const href = titleLink.attr("href") ?? fallbackLink.attr("href") ?? cover.attr("href");
    const mangaId = parseMangaId(href);
    const title = cleanText(
      titleLink.text() || cover.attr("title") || fallbackLink.text() || cover.attr("rel"),
    );
    if (!mangaId || !title || seen.has(mangaId)) return;
    seen.add(mangaId);

    const genres = item
      .find("p.keyWord a")
      .toArray()
      .map((genre) => cleanText($(genre).text()))
      .filter((genre) => genre.length > 0);

    let author: string | undefined;
    let status: string | undefined;
    let views: number | undefined;
    let rank: number | undefined;
    let updatedAt: Date | undefined;
    item.find("p.view").each((_index, viewElement) => {
      const text = cleanText($(viewElement).text());
      const labeled = text.match(/^(Author|Status|Views|Rank):\s*(.*)$/i);
      if (labeled) {
        const value = labeled[2].trim();
        if (!value) return;
        const label = labeled[1].toLowerCase();
        if (label === "author") author = value;
        else if (label === "status") status = value;
        else if (label === "views") views = Number.parseInt(value.replace(/\D/g, ""), 10);
        else rank = Number.parseInt(value.replace(/\D/g, ""), 10);
        return;
      }
      updatedAt ??= parseSiteDate(text);
    });

    const rating = Number.parseFloat(cleanText(item.find("p.score b").first().text()));
    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(item.find("a.manga_cover img").first()),
      genres,
      rating: Number.isFinite(rating) ? rating : undefined,
      author,
      status,
      views: views != null && Number.isFinite(views) ? views : undefined,
      rank: rank != null && Number.isFinite(rank) ? rank : undefined,
      chapter: parseListingChapter(item),
      updatedAt,
    });
  });
  return items;
};

export const parseHasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $("a.next")
    .toArray()
    .some((element) => !($(element).attr("href") ?? "").startsWith("javascript"));

const labeledListText = (
  $: cheerio.CheerioAPI,
  info: cheerio.Cheerio<AnyNode>,
  label: string,
): string => {
  let result = "";
  info.find("li").each((_, element) => {
    if (result) return;
    const item = $(element);
    if (item.find("b").first().text().toLowerCase().includes(label)) {
      result = cleanText(item.text());
    }
  });
  return result;
};

const labeledLinkText = (
  $: cheerio.CheerioAPI,
  info: cheerio.Cheerio<AnyNode>,
  label: string,
): string => {
  let result = "";
  info.find("b").each((_, element) => {
    if (result) return;
    const bold = $(element);
    if (!bold.text().toLowerCase().includes(label)) return;
    result = cleanText(bold.next("a").first().text());
  });
  return result;
};

const parseStatus = ($: cheerio.CheerioAPI, info: cheerio.Cheerio<AnyNode>): string => {
  let licensed = false;
  info.find("div.chapter_content").each((_, element) => {
    if ($(element).text().toLowerCase().includes("has been licensed")) licensed = true;
  });
  if (licensed) return "Licensed";
  const status = labeledListText($, info, "status").toLowerCase();
  if (status.includes("ongoing")) return "Ongoing";
  if (status.includes("completed")) return "Completed";
  return "Unknown";
};

const genreSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const info = $("div.article_content");
  const title = cleanText(info.find("h1").first().text()) || mangaId;
  const author = labeledLinkText($, info, "author");
  const artist = labeledLinkText($, info, "artist");

  const genres: string[] = [];
  info.find("li").each((_, element) => {
    const item = $(element);
    if (!item.find("b").first().text().toLowerCase().includes("genre")) return;
    item.find("a").each((_index, link) => {
      const genre = cleanText($(link).text());
      if (genre) genres.push(genre);
    });
  });

  const ratingMatch = labeledListText($, info, "rating").match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
  const rating = ratingMatch ? Number.parseFloat(ratingMatch[1]) : Number.NaN;

  const secondaryTitles = labeledListText($, info, "alternative")
    .replace(/^alternative\s*name\s*:?/i, "")
    .split(/\s*;\s*/)
    .map(cleanText)
    .filter((value) => value.length > 0 && value.toLowerCase() !== title.toLowerCase());

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
      secondaryTitles,
      thumbnailUrl: imageUrlFrom($("div.detail_info img").first()),
      author: author || undefined,
      artist: artist || undefined,
      synopsis: cleanDescription($("span#show").first().text().replace(/HIDE$/, "")),
      contentRating: contentRatingForGenres(genres),
      status: parseStatus($, info),
      rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
      tagGroups,
      shareUrl: mangaUrl(mangaId),
    },
  };
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  const mangaTitle = sourceManga.mangaInfo.primaryTitle;
  const entries = $("ul.chapter_list li").toArray();
  entries.forEach((element, index) => {
    const item = $(element);
    const link = item.find("a").first();
    const ref = parseChapterRef(link.attr("href"));
    if (!ref || seen.has(ref.chapterId)) return;
    seen.add(ref.chapterId);

    const linkText = cleanText(link.text());
    const extra = item
      .find("span")
      .toArray()
      .map((span) => $(span))
      .filter((span) => {
        const className = span.attr("class") ?? "";
        return !className.includes("time") && !className.includes("new");
      })
      .map((span) => cleanText(span.text()))
      .filter((text) => text.length > 0)
      .join(" ");

    const chapNum = parseChapterNumber(linkText);
    const volumeMatch = ref.chapterId.match(/^v(\d+)\//i);
    chapters.push({
      chapterId: ref.chapterId,
      sourceManga,
      langCode: "en",
      chapNum: chapNum ?? 0,
      title: extra || (chapNum == null ? cleanText(linkText.replace(mangaTitle, "")) : undefined),
      volume: volumeMatch ? Number.parseInt(volumeMatch[1], 10) : 0,
      publishDate: parseSiteDate(item.find("span.time").first().text()),
      // The site lists newest chapters first.
      sortingIndex: entries.length - index,
    });
  });
  return chapters;
};

// The reader carries two page_select blocks; only the one following the
// chapter dropdown lists pages, the other repeats the chapter list.
const PAGE_OPTION_SELECTOR = "select#top_chapter_list ~ div.page_select option";
const FALLBACK_PAGE_OPTION_SELECTOR = "div.manga_read_footer div.page_select option";

export const parseChapterPageUrls = ($: cheerio.CheerioAPI): string[] => {
  const scoped = $(PAGE_OPTION_SELECTOR);
  const options = scoped.length > 0 ? scoped : $(FALLBACK_PAGE_OPTION_SELECTOR);

  const urls: string[] = [];
  const seen = new Set<string>();
  options.each((_, element) => {
    const option = $(element);
    const value = option.attr("value") ?? "";
    // The final option advertises a promo page rather than a chapter page.
    if (!value || /featured/i.test(value) || /featured/i.test(option.text())) return;
    const url = toAbsoluteUrl(value);
    if (seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  });
  return urls;
};

// Every image of a chapter sits in one directory under a zero-padded page
// index, so the whole chapter can be derived from a single page's image URL.
const SEQUENTIAL_IMAGE_REGEX = /^(.*\/)([^/\d]*)(\d+)(\.[A-Za-z0-9]+)$/;

export const buildSequentialImageUrls = (
  imageUrl: string,
  imagePage: number,
  totalPages: number,
): string[] | undefined => {
  const match = imageUrl.match(SEQUENTIAL_IMAGE_REGEX);
  if (!match) return undefined;
  const [, directory, prefix, digits, extension] = match;
  const first = Number.parseInt(digits, 10) - (imagePage - 1);
  if (!Number.isFinite(first) || first < 0) return undefined;
  return Array.from(
    { length: totalPages },
    (_, index) =>
      `${directory}${prefix}${String(first + index).padStart(digits.length, "0")}${extension}`,
  );
};

export const parseViewerImage = ($: cheerio.CheerioAPI): string => {
  const image = $("div#viewer img, img#image, source#image").first();
  return imageUrlFrom(image);
};

export const parseViewerImages = ($: cheerio.CheerioAPI): string[] =>
  $("div#viewer img")
    .toArray()
    .map((element) => imageUrlFrom($(element)))
    .filter((url) => url.length > 0);

const formatCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
};

const formatViews = (views?: number): string | undefined =>
  views != null ? `${formatCount(views)} views` : undefined;

const formatRating = (rating?: number): string | undefined =>
  rating != null ? `★ ${rating.toFixed(2)}` : undefined;

const chapterLabel = (chapter?: ListingChapter): string | undefined => {
  if (!chapter) return undefined;
  return chapter.chapNum != null ? `Ch. ${chapter.chapNum}` : chapter.label || undefined;
};

export const buildFeaturedItem = (item: MangaListItem, author?: string): FeaturedCarouselItem => {
  const infoItems: { symbol: string; text: string }[] = [];
  if (item.rating != null) infoItems.push({ symbol: "star.fill", text: item.rating.toFixed(2) });
  if (item.genres.length > 0) {
    infoItems.push({ symbol: "tag.fill", text: item.genres.slice(0, 3).join(", ") });
  }
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: author ?? item.author,
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
    [formatRating(item.rating), chapterLabel(item.chapter)]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(item.genres),
});

export const toTopItem = (item: MangaListItem): FeaturedCarouselItem => {
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
      [item.rank != null ? `Rank ${item.rank}` : undefined, item.status]
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
      [chapterLabel(item.chapter), formatViews(item.views)]
        .filter((value): value is string => Boolean(value))
        .join(" • ") || undefined,
    publishDate: item.updatedAt,
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toSearchResultItem = (item: MangaListItem): SearchResultItem => ({
  mangaId: item.mangaId,
  title: item.title,
  imageUrl: item.imageUrl,
  subtitle:
    [formatRating(item.rating), item.status]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(item.genres),
});
