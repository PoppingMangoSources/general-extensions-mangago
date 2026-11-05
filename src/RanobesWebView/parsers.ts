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
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  COVER_FALLBACK,
  DOMAIN,
  GENRES,
  FILTER_OPTION_FALLBACKS,
  type FilterTaxonomy,
  type ListingType,
  type RanobesChapterEntry,
  type RanobesChapterPage,
  type RanobesListing,
} from "./models";
import { toFilterOptionId } from "./network";

const absoluteUrl = (value: string): string => {
  const url = value.trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value.replace(/\s+/g, " ").trim());

const parseCount = (value: string): number | undefined => {
  const digits = value.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : undefined;
};

const parseImageUrl = (element: cheerio.Cheerio<AnyNode>): string => {
  const source = [
    element.attr("data-src"),
    element.attr("data-original"),
    element.attr("data-lazy-src"),
    element.attr("src"),
  ].find((value) => value?.trim() && !value.includes("data:image"));
  if (source) return absoluteUrl(source);

  const background = element.attr("style")?.match(/url\(['"]?([^)'"\s]+)['"]?\)/i)?.[1];
  return background ? absoluteUrl(background) : "";
};

const parseRating = (card: cheerio.Cheerio<AnyNode>): { rating?: number; ratingCount?: number } => {
  const rating = parseFloat(card.find(".r-date .rate-drop strong").first().text());
  return {
    rating: Number.isFinite(rating) ? rating : undefined,
    ratingCount: parseCount(
      card.find("[id^='vote-num-id-'], .rank-story-data-info").first().text(),
    ),
  };
};

const parseViews = (card: cheerio.Cheerio<AnyNode>): number | undefined => {
  for (const node of card.find(".meta_author").toArray()) {
    const title = node.type === "tag" ? (node.attribs.title ?? "") : "";
    const views = title.match(/views:\s*([\d\s]+)/i)?.[1];
    if (views) return parseCount(views);
  }

  const stats = card.find(".rank-story-data").first();
  return stats.find(".fa-eye").length
    ? parseCount(stats.find(".rank-story-data-val").first().text())
    : undefined;
};

const parseGenres = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  selector: string,
): string[] =>
  card
    .find(selector)
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);

const parseRelativeDate = (value: string): Date | undefined => {
  const text = value.toLowerCase().trim();
  if (!text) return undefined;
  if (text.includes("less than a minute") || text === "just now") return new Date();

  const count = Number(text.match(/\d+/)?.[0] ?? 0);
  const unit = [
    ["minute", 60_000],
    ["hour", 3_600_000],
    ["day", 86_400_000],
    ["week", 604_800_000],
    ["month", 2_629_800_000],
    ["year", 31_557_600_000],
  ].find(([name]) => text.includes(String(name)))?.[1];
  if (typeof unit === "number") return new Date(Date.now() - count * unit);

  return parseChapterDate(value);
};

const novelUrlFromChapter = (href: string): string => {
  const url = absoluteUrl(href);
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  const match = path.match(/^\/([^/]+)-(\d+)\/\d+\.html$/i);
  if (!match) return url;
  return `${DOMAIN}/novels/${match[2]}-${match[1].replace(/-\d+$/, "")}.html`;
};

export const extractNovelId = (mangaId: string): string => {
  const match = mangaId.match(/\/novels\/(\d+)-/i);
  if (!match) throw new Error(`Ranobes: could not identify novel ${mangaId}`);
  return match[1];
};

export const parseFilterTaxonomy = ($: cheerio.CheerioAPI): FilterTaxonomy => {
  const options = (include: string, exclude: string, fallback: readonly string[]) => {
    const items = new Map<string, string>();
    const fields = [include, exclude].flatMap((name) => [name, `${name}[]`]);
    const selects = fields.map((name) => `select[name="${name}"] option`).join(", ");
    for (const option of $(selects)) {
      const title = cleanText($(option).text());
      const value = $(option).attr("value") ?? title;
      if (value.trim() && title && !$(option).is("[disabled]")) {
        items.set(toFilterOptionId(value), title);
      }
    }
    return items.size
      ? Array.from(items, ([id, title]) => ({ id, title }))
      : fallback.map((title) => ({ id: toFilterOptionId(title), title }));
  };
  return {
    genres: options("n.genre", "v.genre", GENRES),
    events: options("n.events", "v.events", FILTER_OPTION_FALLBACKS.events),
    authors: options("n.authors", "v.authors", FILTER_OPTION_FALLBACKS.authors),
    translators: options("n.translater", "v.translater", FILTER_OPTION_FALLBACKS.translators),
    publishers: options("n.l.tags", "!m.tags", FILTER_OPTION_FALLBACKS.publishers),
  };
};

export const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (["adult", "hentai", "smut", "yaoi"].some((genre) => normalized.includes(genre))) {
    return ContentRating.ADULT;
  }
  if (["ecchi", "mature"].some((genre) => normalized.includes(genre))) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

const formatCount = (value: number): string => value.toLocaleString("en-US");

export const toFeaturedItem = (listing: RanobesListing): DiscoverSectionItem => ({
  type: "featuredCarouselItem",
  mangaId: listing.mangaId,
  title: listing.title,
  imageUrl: listing.imageUrl,
  summary: listing.description,
  infoItems:
    listing.rating !== undefined && listing.views !== undefined
      ? [
          {
            symbol: "star.fill",
            text: `${listing.rating.toFixed(1)}${
              listing.ratingCount ? ` (${listing.ratingCount})` : ""
            }`,
          },
          { symbol: "eye.fill", text: formatCount(listing.views) },
        ]
      : listing.rating !== undefined
        ? [
            {
              symbol: "star.fill",
              text: `${listing.rating.toFixed(1)}${
                listing.ratingCount ? ` (${listing.ratingCount})` : ""
              }`,
            },
          ]
        : listing.views !== undefined
          ? [{ symbol: "eye.fill", text: formatCount(listing.views) }]
          : undefined,
  contentRating: contentRatingForGenres(listing.genres ?? []),
});

export const toChapterUpdateItem = (listing: RanobesListing): DiscoverSectionItem | undefined => {
  if (!listing.chapterId) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: listing.mangaId,
    chapterId: listing.chapterId,
    title: listing.title,
    imageUrl: listing.imageUrl,
    subtitle: listing.chapterTitle || undefined,
    publishDate: listing.publishDate,
  };
};

export const toRankingItem = (
  listing: RanobesListing,
  rank: number,
  useRating: boolean,
): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: listing.mangaId,
  title: listing.title,
  imageUrl: listing.imageUrl,
  subtitle: useRating
    ? `#${rank} • Rating ${listing.rating?.toFixed(1) ?? "unavailable"}${
        listing.ratingCount ? ` (${listing.ratingCount})` : ""
      }`
    : `#${rank} • ${formatCount(listing.views ?? 0)} views`,
  contentRating: contentRatingForGenres(listing.genres ?? []),
});

export const toCompletedItem = (listing: RanobesListing): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: listing.mangaId,
  title: listing.title,
  imageUrl: listing.imageUrl,
  subtitle:
    listing.views !== undefined
      ? `${formatCount(listing.views)} views`
      : listing.rating !== undefined
        ? `Rating ${listing.rating.toFixed(1)}`
        : undefined,
  contentRating: contentRatingForGenres(listing.genres ?? []),
});

export const toSearchResult = (listing: RanobesListing): SearchResultItem => ({
  mangaId: listing.mangaId,
  title: listing.title,
  imageUrl: listing.imageUrl,
  subtitle: listing.rating !== undefined ? `Rating ${listing.rating.toFixed(1)}` : undefined,
  contentRating: contentRatingForGenres(listing.genres ?? []),
});

const parseNovelCard = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  ranking: boolean,
): RanobesListing | undefined => {
  const link = card.find("h2.title a").first();
  const mangaId = absoluteUrl(link.attr("href") ?? "");
  const title = cleanText(link.text());
  const cover = card.find(ranking ? "figure.fit-cover img" : "figure.cover").first();
  const imageUrl = parseImageUrl(cover) || parseImageUrl(cover.find("img").first());
  if (!mangaId || !title || !imageUrl) return undefined;

  return {
    mangaId,
    title,
    imageUrl,
    description: cleanText(
      card
        .find(ranking ? ".moreless__short" : ".cont-in > div[style*='color']")
        .first()
        .text(),
    ),
    ...parseRating(card),
    views: parseViews(card),
    genres: parseGenres($, card, ranking ? ".rank-story-genre a" : ".r-rate .grey a"),
  };
};

const parseUpdate = (card: cheerio.Cheerio<AnyNode>): RanobesListing | undefined => {
  const link = card.find("a").first();
  const chapterId = absoluteUrl(link.attr("href") ?? "");
  const title = cleanText(card.find("h3.title").text());
  const imageUrl = parseImageUrl(card.find("i.image.cover").first());
  if (!chapterId || !title || !imageUrl) return undefined;

  return {
    mangaId: novelUrlFromChapter(chapterId),
    chapterId,
    chapterTitle: cleanText(card.find(".subtitle").text()),
    title,
    imageUrl,
    publishDate: parseRelativeDate(card.find("em").text()),
  };
};

export const parseListings = ($: cheerio.CheerioAPI, type: ListingType): RanobesListing[] => {
  const listings: RanobesListing[] = [];
  if (type === "updates") {
    for (const element of $("div.block.story_line.story_line-img").toArray()) {
      const listing = parseUpdate($(element));
      if (listing) listings.push(listing);
    }
    return listings;
  }

  const ranking = type === "rankings";
  const selector = ranking ? "article.rank-story" : "article.block.story.shortstory";
  for (const element of $(selector).toArray()) {
    const listing = parseNovelCard($, $(element), ranking);
    if (listing) listings.push(listing);
  }
  return listings;
};

export const parseHomepageRated = ($: cheerio.CheerioAPI): RanobesListing[] =>
  $("#news_top .story_line.story_line-img")
    .toArray()
    .flatMap((element) => {
      const card = $(element);
      const link = card.find("a").first();
      const mangaId = absoluteUrl(link.attr("href") ?? "");
      const title = cleanText(card.find(".title").first().text());
      const imageUrl = parseImageUrl(card.find("i.image.cover").first());
      if (!mangaId || !title || !imageUrl) return [];

      const ratingText = cleanText(card.find(".meta").text());
      const rating = Number(ratingText.match(/rating:\s*([\d.]+)/i)?.[1]);
      return [
        {
          mangaId,
          title,
          imageUrl,
          rating: Number.isFinite(rating) ? rating : undefined,
          ratingCount: parseCount(card.find("[id^='vote-num-id-']").first().text()),
        },
      ];
    });

export const isLastListingPage = ($: cheerio.CheerioAPI): boolean =>
  $(".navigation .page_next a").length === 0;

const parseSynopsis = ($: cheerio.CheerioAPI): string => {
  const container = $(".r-desription .cont-text").first().clone();
  // Some titles put genre/tag links in the description container; they belong to tags, not prose.
  container.find('a[href*="/genre"], a[href*="/tags/"], a[href*="/category/"]').remove();
  const html = container.html() ?? "";
  return cleanText(
    html
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\n\s+/g, "\n"),
  );
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const title = cleanText(
    $("h1.title")
      .first()
      .contents()
      .filter((_, node) => node.type === "text")
      .text(),
  );
  if (!title) throw new Error(`Ranobes: no novel title found for ${mangaId}`);

  const secondaryTitle = cleanText($("h1.title .subtitle").first().text());
  const collect = (selector: string): string[] =>
    $(selector)
      .toArray()
      .map((element) => cleanText($(element).text()))
      .filter(Boolean);
  const genres = collect("#mc-fs-genre .links a, .r-desription .grey a[href*='/tags/genre/']");
  const keywords = collect("#mc-fs-keyw .links a").slice(0, 10);
  const specs = $(".r-fullstory-spec li");
  const spec = (label: string) =>
    specs.filter((_, element) => $(element).text().toLowerCase().includes(label));
  const authors = spec("authors:")
    .find("a")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  const language = cleanText(spec("language:").find("a").first().text());
  const status = cleanText(spec("status in coo").find("a").first().text());
  const rating = parseFloat($("#mc-fs-rate .rate-stat-num .bold").first().text());
  const cover = $(".r-fullstory-poster figure.cover").first();
  const views = parseCount($(".r-fullstory-spec li[title^='Unique views'] .grey").first().text());
  const toTags = (names: string[]): Tag[] =>
    names.map((name) => ({ id: toFilterOptionId(name), title: name }));
  const tagGroups: TagSection[] = [];
  if (genres.length) tagGroups.push({ id: "genres", title: "Genres", tags: toTags(genres) });
  if (keywords.length) tagGroups.push({ id: "tags", title: "Tags", tags: toTags(keywords) });

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: secondaryTitle ? [secondaryTitle] : [],
      thumbnailUrl:
        parseImageUrl(cover) || parseImageUrl(cover.find("img").first()) || COVER_FALLBACK,
      synopsis: parseSynopsis($),
      author: authors.length ? authors.join(", ") : undefined,
      status: status || undefined,
      contentRating: contentRatingForGenres(genres),
      contentType: "novel",
      rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
      tagGroups: tagGroups.length ? tagGroups : undefined,
      additionalInfo: {
        ...(language ? { language } : {}),
        ...(views !== undefined ? { views: String(views) } : {}),
      },
      shareUrl: mangaId,
    },
  };
};

const isChapterEntry = (value: unknown): value is RanobesChapterEntry =>
  typeof value === "object" &&
  value !== null &&
  "link" in value &&
  typeof value.link === "string" &&
  value.link.trim().length > 0 &&
  "title" in value &&
  typeof value.title === "string";

const chapterPageNumber = (value: unknown, name: string, minimum: number): number | undefined => {
  if (value == null) return undefined;
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < minimum) {
    throw new Error(`Ranobes: invalid chapter pagination field ${name}.`);
  }
  return number;
};

export const parseChapterPage = ($: cheerio.CheerioAPI): RanobesChapterPage => {
  const script = $("script")
    .toArray()
    .map((element) => /window\.__DATA__\s*=\s*(\{[\s\S]*\})/.exec($(element).text())?.[1])
    .find(Boolean);
  if (!script) throw new Error("Ranobes: chapter data was not found.");

  let data: unknown;
  try {
    data = JSON.parse(script);
  } catch {
    throw new Error("Ranobes: could not parse the chapter list.");
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("chapters" in data) ||
    !Array.isArray(data.chapters) ||
    !data.chapters.length ||
    !data.chapters.every(isChapterEntry)
  ) {
    throw new Error("Ranobes: invalid or empty chapter-list page.");
  }
  return {
    chapters: data.chapters,
    pages_count: chapterPageNumber(
      "pages_count" in data ? data.pages_count : undefined,
      "pages_count",
      1,
    ),
    count_all: chapterPageNumber("count_all" in data ? data.count_all : undefined, "count_all", 0),
    cstart: chapterPageNumber("cstart" in data ? data.cstart : undefined, "cstart", 1),
    limit: chapterPageNumber("limit" in data ? data.limit : undefined, "limit", 1),
  };
};

export const sameChapterPage = (current: RanobesChapterPage, saved: RanobesChapterPage): boolean =>
  current.count_all === saved.count_all &&
  current.pages_count === saved.pages_count &&
  current.limit === saved.limit &&
  current.chapters.length === saved.chapters.length &&
  current.chapters.every((chapter, index) => chapter.link === saved.chapters[index].link);

// Chapter timestamps arrive zoneless; treating them as device-local makes fresh
// ones render as negative ages. Read as UTC.
const parseChapterDate = (value: string): Date | undefined => {
  const text = value.trim();
  if (!text) return undefined;

  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);

  let date: Date | undefined;
  if (ymd) {
    date = new Date(
      Date.UTC(+ymd[1], +ymd[2] - 1, +ymd[3], +(ymd[4] ?? 0), +(ymd[5] ?? 0), +(ymd[6] ?? 0)),
    );
  } else if (dmy) {
    const year = +dmy[3] < 100 ? +dmy[3] + 2000 : +dmy[3];
    date = new Date(
      Date.UTC(year, +dmy[2] - 1, +dmy[1], +(dmy[4] ?? 0), +(dmy[5] ?? 0), +(dmy[6] ?? 0)),
    );
  } else {
    date = new Date(text);
  }

  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date;
};

const parseChapterTitle = (value: string): { chapNum?: number; title?: string } => {
  const title = cleanText(value);
  const match = /^chapter\s+(\d+(?:\.\d+)?)\s*(?:[:.\-–—]\s*)?(.*)$/i.exec(title);
  if (!match) return { title };
  const subtitle = cleanText(match[2]);
  return { chapNum: Number(match[1]), title: subtitle || undefined };
};

export const parseChapters = (pages: RanobesChapterPage[], sourceManga: SourceManga): Chapter[] => {
  const seen = new Set<string>();
  const entries = pages
    .flatMap((page) => page.chapters)
    .filter((entry) => {
      const id = absoluteUrl(entry.link);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  if (!entries.length) throw new Error(`Ranobes: no chapters found for ${sourceManga.mangaId}`);

  // Site lists chapters newest-first; keep that order, newest gets the highest index.
  const total = entries.length;
  return entries.map((entry, index) => {
    const chapter = parseChapterTitle(entry.title);
    return {
      chapterId: absoluteUrl(entry.link),
      sourceManga,
      langCode: "en",
      chapNum: chapter.chapNum ?? total - index,
      ...(chapter.title ? { title: chapter.title } : {}),
      volume: 0,
      sortingIndex: total - index,
      publishDate: typeof entry.date === "string" ? parseChapterDate(entry.date) : undefined,
    };
  });
};

const toXhtml = (fragment: string): string => {
  const body = cheerio
    .load(fragment, null, false)
    .html({ xml: true })
    .replace(/\s+epub:[\w-]+=(["'])(.*?)\1/gi, "")
    .replace(/\s+xmlns:[\w-]+=(["'])(.*?)\1/gi, "")
    .replace(/\s+on[\w-]+=(["'])(.*?)\1/gi, "")
    .replace(
      /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)(\s[^>]*?)?>/gi,
      (match, tag, attrs = "") => (match.endsWith("/>") ? match : `<${tag}${attrs} />`),
    );
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
};

export const parseChapterDetails = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const article = $("#arrticle").first();
  if (!article.length) {
    throw new Error(`Ranobes: no readable content found for ${chapter.chapterId}`);
  }

  article.find("script, .free-support, .free-support-top, .free-support-bottom, .pubadx").remove();
  article.find("img").each((_, element) => {
    const image = $(element);
    const imageUrl = parseImageUrl(image);
    if (imageUrl) image.attr("src", imageUrl);
    image.removeAttr("data-src");
    image.removeAttr("data-original");
    image.removeAttr("data-lazy-src");
    image.removeAttr("srcset");
  });

  const body = article.html()?.trim();
  if (!body) throw new Error(`Ranobes: empty chapter content for ${chapter.chapterId}`);
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: toXhtml(body),
  };
};
