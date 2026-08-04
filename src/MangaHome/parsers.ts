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
const MATURE_GENRES = new Set(["ecchi", "mature", "smut", "yaoi", "yuri", "doujinshi"]);

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

// Chapter URLs are /manga/<slug>/c<number>/, optionally with a volume segment.
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
  const match = text.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month != null) {
      return new Date(Number.parseInt(match[3], 10), month, Number.parseInt(match[2], 10));
    }
  }
  if (/today/i.test(text)) return startOfDay(0);
  if (/yesterday/i.test(text)) return startOfDay(1);
  return undefined;
};

const parseChapterNumber = (value: string): number | undefined => {
  const match =
    value.match(/(?:ch\.?|chapter)\s*(\d+(?:\.\d+)?)/i) ?? value.match(/(\d+(?:\.\d+)?)\s*$/);
  return match ? Number.parseFloat(match[1]) : undefined;
};

const parseCount = (value: string): number | undefined => {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return undefined;
  const count = Number.parseInt(digits, 10);
  return Number.isFinite(count) ? count : undefined;
};

// Listing cards read `<a title>` for the full name; the visible text is
// truncated with an ellipsis once it passes the card width.
const fullTitle = (link: cheerio.Cheerio<AnyNode>): string =>
  cleanText(link.attr("title") ?? link.attr("rel") ?? link.text());

const parseListingChapter = (
  $: cheerio.CheerioAPI,
  item: cheerio.Cheerio<AnyNode>,
): ListingChapter | undefined => {
  const link = item
    .find("a[href]")
    .toArray()
    .map((element) => $(element))
    .find((anchor) => parseChapterRef(anchor.attr("href")) !== undefined);
  const ref = parseChapterRef(link?.attr("href"));
  if (!link || !ref) return undefined;
  const label = cleanText(link.attr("title") ?? link.text());
  return { chapterId: ref.chapterId, label, chapNum: parseChapterNumber(label) };
};

// Directory, latest and search listings all render the same card: a cover
// link, a title, a star score, a "<rank> <views> views" line, the newest
// chapter and its date.
export const parseMangaList = ($: cheerio.CheerioAPI): MangaListItem[] => {
  const items: MangaListItem[] = [];
  const seen = new Set<string>();

  $("ul.manga-list > li").each((_, element) => {
    const item = $(element);
    const cover = item.find("a.post-cover").first();
    if (cover.length === 0) return;

    const titleLink = item.find("p.title a").first();
    const mangaId = parseMangaId(titleLink.attr("href") ?? cover.attr("href"));
    const title = fullTitle(titleLink.length > 0 ? titleLink : cover);
    if (!mangaId || !title || seen.has(mangaId)) return;
    seen.add(mangaId);

    const rating = Number.parseFloat(cleanText(item.find(".star-score").first().text()));

    // The stats line reads "1st   1314034 views"; the ordinal is the site's
    // rank and the number before "views" is the view count.
    const statsText = item
      .find("div.cover-info > p")
      .toArray()
      .map((paragraph) => cleanText($(paragraph).text()))
      .find((text) => /views/i.test(text));
    const statsMatch = statsText?.match(/^(\d+)\D*?(\d[\d,]*)\s*views/i);

    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(cover.find("img").first()),
      genres: item
        .find("p.genre a")
        .toArray()
        .map((genre) => cleanText($(genre).text()))
        .filter((genre) => genre.length > 0),
      rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
      views: statsMatch ? parseCount(statsMatch[2]) : undefined,
      rank: statsMatch ? Number.parseInt(statsMatch[1], 10) : undefined,
      chapter: parseListingChapter($, item),
      updatedAt: parseSiteDate(item.find("p.time").first().text()),
    });
  });

  return items;
};

// Home-page recommendation carousels only carry a cover and a title.
export const parseRecommendList = ($: cheerio.CheerioAPI, heading: string): MangaListItem[] => {
  const block = $("div.title-recommend p")
    .toArray()
    .map((element) => $(element))
    .find((title) => cleanText(title.text()) === heading)
    ?.closest("div.manga-recommend");
  if (!block || block.length === 0) return [];

  const items: MangaListItem[] = [];
  const seen = new Set<string>();
  block.find("ul.postbig-list li a.postbig-info").each((_, element) => {
    const link = $(element);
    const mangaId = parseMangaId(link.attr("href"));
    const title = fullTitle(link);
    if (!mangaId || !title || seen.has(mangaId)) return;
    seen.add(mangaId);
    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(link.find("img").first()),
      genres: [],
    });
  });
  return items;
};

// A ranking block lists its top three as full cards, then the rest as compact
// rows carrying only a rank, a title and a count.
const readChartsList = (
  $: cheerio.CheerioAPI,
  content: cheerio.Cheerio<AnyNode>,
): MangaListItem[] => {
  const items: MangaListItem[] = [];
  const seen = new Set<string>();

  content.find("div.post").each((_, element) => {
    const post = $(element);
    const link = post.find("p.title a").first();
    const mangaId = parseMangaId(link.attr("href"));
    const title = fullTitle(link);
    if (!mangaId || !title || seen.has(mangaId)) return;
    seen.add(mangaId);

    const rating = Number.parseFloat(cleanText(post.find(".star-score").first().text()));
    const statsText = cleanText(post.find("span.viewsnumber").first().parent().text());

    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(post.find("a.post-cover img").first()),
      genres: [],
      rating: Number.isFinite(rating) && rating > 0 ? rating : undefined,
      views: parseCount(statsText.replace(/^\D+/, "")),
      rank: parseCount(cleanText(post.find("sup.numbertop").first().text())),
    });
  });

  content.find("div.chartsli-text").each((_, element) => {
    const row = $(element);
    const link = row.find("a.supnumb-name").first();
    const mangaId = parseMangaId(link.attr("href"));
    const title = fullTitle(link);
    if (!mangaId || !title || seen.has(mangaId)) return;
    seen.add(mangaId);

    items.push({
      mangaId,
      title,
      imageUrl: "",
      genres: [],
      views: parseCount(cleanText(row.find("span.supnumb-views").first().text())),
      rank: parseCount(cleanText(row.find("sup.supnumb-other").first().text())),
    });
  });

  return items;
};

// A ranking block's heading wraps its name in an <em> followed by the period,
// and the chart itself is the block that comes right after it.
export const parseRankSection = ($: cheerio.CheerioAPI, heading: string): MangaListItem[] => {
  const content = $("div.title-top em")
    .toArray()
    .map((element) => $(element))
    .find((title) => cleanText(title.text()) === heading)
    ?.closest("div.title-top")
    .next("div.main-content");
  return content && content.length > 0 ? readChartsList($, content) : [];
};

// The feelings ranking renders one chart per mood tab, in the order the tabs
// are listed; all but the first are hidden until the reader switches tab.
export const parseFeelingSection = ($: cheerio.CheerioAPI, index: number): MangaListItem[] => {
  const content = $("div.main-content.feeling_content").eq(index);
  return content.length > 0 ? readChartsList($, content) : [];
};

export const parseHasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $("a.next")
    .toArray()
    .some((element) => {
      const href = $(element).attr("href") ?? "";
      return href.length > 0 && !href.startsWith("javascript");
    });

const genreSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const detail = $("div.manga-detail");
  const info = detail.find("div.detail-info");
  const title = cleanText(detail.find("h1").first().text()) || mangaId;

  const linkNames = (selector: string): string =>
    [
      ...new Set(
        info
          .find(selector)
          .toArray()
          .map((element) => cleanText($(element).text()))
          .filter((name) => name.length > 0),
      ),
    ].join(", ");

  // Each stat is a <span> label followed by its value; drop the child nodes to
  // read the value, since the status row also carries a "coming next" link.
  const stat = (label: string): string => {
    const row = info
      .find("p")
      .toArray()
      .map((element) => $(element))
      .find((paragraph) => cleanText(paragraph.find("span").first().text()).startsWith(label));
    return row ? cleanText(row.clone().children().remove().end().text()) : "";
  };

  // The middle block holds the alternative names and the genre links, each in a
  // paragraph introduced by its own label.
  const labelledParagraph = (label: string) =>
    detail
      .find("div.manga-detailmiddle p")
      .toArray()
      .map((element) => $(element))
      .find((paragraph) => cleanText(paragraph.find("span").first().text()).startsWith(label));

  const genres = (labelledParagraph("Genre") ?? $())
    .find("a")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter((genre) => genre.length > 0);

  const secondaryTitles = cleanText(
    (labelledParagraph("Alternative") ?? $()).clone().children().remove().end().text(),
  )
    .split(/\s*;\s*/)
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0 && alias.toLowerCase() !== title.toLowerCase());

  const statusText = stat("Status").toLowerCase();
  const rating = Number.parseFloat(cleanText(info.find("i.score-number").first().text()));

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
      thumbnailUrl: imageUrlFrom(detail.find("img.detail-cover").first()),
      author: linkNames('a[href*="/author/"]') || undefined,
      artist: linkNames('a[href*="/artist/"]') || undefined,
      synopsis: cleanDescription(
        detail
          .find("div.manga-detailmiddle p.hide")
          .first()
          .text()
          .replace(/\s*More$/i, ""),
      ),
      contentRating: contentRatingForGenres(genres),
      status: statusText.includes("completed")
        ? "Completed"
        : statusText.includes("ongoing")
          ? "Ongoing"
          : undefined,
      rating: Number.isFinite(rating) && rating > 0 ? Math.min(1, rating / 5) : undefined,
      tagGroups,
      shareUrl: mangaUrl(mangaId),
    },
  };
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  // Only the chapter list itself: the page also links the not-yet-released
  // "coming next" chapter and a "Start Reading" shortcut to the first one.
  const rows = $("ul.detail-chlist > li").toArray();

  const chapters = rows.flatMap((element, index) => {
    const row = $(element);
    const ref = parseChapterRef(row.find("a").first().attr("href"));
    if (!ref) return [];

    const label = cleanText(row.find("span.pc-none").first().text());
    const volume = parseChapterNumber(cleanText(row.find("span.vol").first().text()));

    return [
      {
        chapterId: ref.chapterId,
        sourceManga,
        langCode: "en",
        chapNum:
          parseChapterNumber(label) ?? parseChapterNumber(ref.chapterId) ?? rows.length - index,
        volume: volume ?? 0,
        publishDate: parseSiteDate(row.find("span.time").first().text()),
        // The list is newest first.
        sortingIndex: rows.length - index,
      },
    ];
  });

  if (chapters.length === 0) {
    if (/has been licensed/i.test($("div.manga-detailchapter").text())) {
      throw new Error(`${sourceManga.mangaInfo.primaryTitle} is licensed and cannot be read here.`);
    }
    throw new Error(`No chapters found for ${sourceManga.mangaId}`);
  }
  return chapters;
};

// The reader renders the whole chapter in one viewer, so every page image is
// already on the chapter page.
export const parseChapterImages = ($: cheerio.CheerioAPI): string[] => [
  ...new Set(
    $("#viewer img, section.mangaread-img img")
      .toArray()
      .map((element) => imageUrlFrom($(element)))
      .filter((url) => url.length > 0),
  ),
];

const formatCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return `${count}`;
};

const chapterLabel = (chapter?: ListingChapter): string | undefined => {
  if (!chapter) return undefined;
  return chapter.chapNum != null ? `Ch. ${chapter.chapNum}` : chapter.label || undefined;
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
    supertitle: item.rank != null ? `No. ${item.rank}` : undefined,
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
    [item.rating != null ? `★ ${item.rating.toFixed(2)}` : undefined, chapterLabel(item.chapter)]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(item.genres),
});

// Ranked carousels lead with the site's own position, then its view count.
export const toRankedItem = (item: MangaListItem, index: number): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle:
    [`#${item.rank ?? index + 1}`, item.views != null ? formatCount(item.views) : undefined]
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
    subtitle: chapterLabel(item.chapter),
    publishDate: item.updatedAt,
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toSearchResultItem = (item: MangaListItem): SearchResultItem => ({
  mangaId: item.mangaId,
  title: item.title,
  imageUrl: item.imageUrl,
  subtitle:
    [
      item.rating != null ? `★ ${item.rating.toFixed(2)}` : undefined,
      item.views != null ? `${formatCount(item.views)} views` : undefined,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(item.genres),
});
