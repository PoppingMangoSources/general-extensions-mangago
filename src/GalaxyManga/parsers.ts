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
  type Tag,
  type TagSection,
} from "@paperback/types";
import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { DOMAIN, MANGA_DIR, TYPE_COUNTRIES, type LatestCard, type MangaCard } from "./models";
import { mangaUrl } from "./network";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const ADULT_GENRES = new Set(["adult", "hentai", "pornographic", "erotica"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "smut", "yaoi", "yuri", "adult romance"]);

const DETAILS_SCOPE = "div.bigcontent, div.animefull, div.main-info, div.postbody";
const TITLE_SELECTOR = "h1.entry-title, .ts-breadcrumb li:last-child span";
const THUMB_SELECTOR = ".infomanga > div[itemprop=image] img, .thumb img";
const DESC_SELECTOR = ".desc, .entry-content[itemprop=description]";
const ALT_NAME_SELECTOR = ".alternative, .wd-full:contains(alt) span, .alter, .seriestualt";
const GENRE_SELECTOR = "div.gnr a, .mgen a, .seriestugenre a";
const AUTHOR_SELECTOR =
  ".infotable tr:contains(Author) td:last-child, .tsinfo .imptdt:contains(Author) i, .fmed b:contains(Author)+span";
const ARTIST_SELECTOR =
  ".infotable tr:contains(Artist) td:last-child, .tsinfo .imptdt:contains(Artist) i, .fmed b:contains(Artist)+span";
const STATUS_SELECTOR =
  ".infotable tr:contains(Status) td:last-child, .tsinfo .imptdt:contains(Status) i, .fmed b:contains(Status)+span";
const CHAPTER_SELECTOR =
  "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)";
const CHAPTER_NAME_SELECTOR = ".lch a, .chapternum";
const CHAPTER_DATE_SELECTOR = ".chapterdate";
const PAGE_SELECTOR = "div#readerarea img";
const IMAGE_LIST_REGEX = /"images"\s*:\s*(\[.*?\])/s;

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

const sanitizeId = (value: string): string => value.replace(SAFE_ID_REGEX, "-");

export const parseMangaId = (value?: string | null): string =>
  sanitizeId((value ?? "").match(new RegExp(`/${MANGA_DIR}/([^/?#]+)`, "i"))?.[1] ?? "");

const parseChapterId = (value?: string | null): string => {
  const path = (value ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return sanitizeId(path.split("/").pop() ?? "");
};

const toAbsoluteUrl = (value?: string | null): string => {
  const url = Application.decodeHTMLEntities(value ?? "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>): string => {
  const srcset = image
    .attr("srcset")
    ?.split(",")
    .map((entry) => {
      const [url, width] = entry.trim().split(/\s+/);
      return { url, width: Number.parseInt(width, 10) || 0 };
    })
    .filter((entry) => entry.url)
    .sort((left, right) => right.width - left.width)[0]?.url;
  return toAbsoluteUrl(
    image.attr("data-lazy-src") ??
      image.attr("data-src") ??
      image.attr("data-cfsrc") ??
      srcset ??
      image.attr("src"),
  );
};

export const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

export const parseDate = (value?: string | null): Date | undefined => {
  const text = cleanText(value);
  if (!text) return undefined;

  const absolute = text.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (absolute) {
    const month = MONTHS[absolute[1].toLowerCase().slice(0, 3)];
    if (month != null) {
      return new Date(
        Date.UTC(Number.parseInt(absolute[3], 10), month, Number.parseInt(absolute[2], 10)),
      );
    }
  }

  const relative = text.toLowerCase().match(/(\d+)\s*(second|min|hour|day|week|month|year)/);
  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const milliseconds = {
      second: 1_000,
      min: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    }[relative[2]];
    if (milliseconds) return new Date(Date.now() - amount * milliseconds);
  }

  const direct = new Date(text);
  return Number.isNaN(direct.getTime()) ? undefined : direct;
};

const chapterLabel = (chapter?: string): string | undefined => {
  if (!chapter) return undefined;
  const number = chapter.match(/(\d+(?:\.\d+)?)/)?.[1];
  return number ? `Ch. ${number}` : chapter;
};

const parseCard = ($: cheerio.CheerioAPI, element: AnyNode): MangaCard | undefined => {
  const unit = $(element);
  const link = unit.is("a") ? unit : unit.find("a").first();
  const href = link.attr("href") ?? "";
  const mangaId = parseMangaId(href);
  if (!mangaId) return undefined;

  const image = unit.find("img").first();
  const title = cleanText(
    unit.find(".bigor .tt a").first().text() ||
      unit.find(".bigor .tt").first().text() ||
      image.attr("title") ||
      link.attr("title"),
  );
  if (!title) return undefined;

  const typeName = (unit.find("span.type").first().attr("class") ?? "")
    .replace(/\btype\b/, "")
    .trim();

  return {
    mangaId,
    title,
    imageUrl: imageUrlFrom(image),
    chapter: cleanText(unit.find(".epxs").first().text()) || undefined,
    rating: cleanText(unit.find(".numscore").first().text()) || undefined,
    typeName: typeName || undefined,
    genres: [],
  };
};

export const parseCards = ($: cheerio.CheerioAPI): MangaCard[] => {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  $(".listupd .bs .bsx, .listo .bs .bsx").each((_, element) => {
    const card = parseCard($, element);
    if (!card || seen.has(card.mangaId)) return;
    seen.add(card.mangaId);
    cards.push(card);
  });
  return cards;
};

const widgetByHeading = ($: cheerio.CheerioAPI, heading: string): cheerio.Cheerio<AnyNode> =>
  $(`.releases:contains("${heading}")`).first().closest(".bixbox, .section");

export const parseWidgetCards = ($: cheerio.CheerioAPI, heading: string): MangaCard[] => {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  widgetByHeading($, heading)
    .find(".bsx")
    .each((_, element) => {
      const card = parseCard($, element);
      if (!card || seen.has(card.mangaId)) return;
      seen.add(card.mangaId);
      cards.push(card);
    });
  return cards;
};

export const parseLatestCards = ($: cheerio.CheerioAPI): LatestCard[] => {
  const cards: LatestCard[] = [];
  const seen = new Set<string>();
  widgetByHeading($, "Latest Update")
    .find(".bsx")
    .each((_, element) => {
      const card = parseCard($, element);
      if (!card || seen.has(card.mangaId)) return;
      seen.add(card.mangaId);

      const latestChapter = $(element).find("ul.chfiv li a").first();
      const chapterHref = latestChapter.attr("href") ?? "";
      const chapterName = cleanText(latestChapter.find(".fivchap").text());
      cards.push({
        ...card,
        chapterId: chapterHref ? parseChapterId(chapterHref) : undefined,
        chapterName: chapterName || undefined,
        publishDate: parseDate(latestChapter.find(".fivtime").text()),
      });
    });
  return cards;
};

export const parseTrendingCards = ($: cheerio.CheerioAPI, range: string): MangaCard[] => {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  $(`.serieslist.wpop.${range} ul li, #wpop-items .${range} ul li`).each((_, element) => {
    const item = $(element);
    const link = item.find("a.series").first();
    const mangaId = parseMangaId(link.attr("href"));
    if (!mangaId || seen.has(mangaId)) return;
    const title = cleanText(item.find(".leftseries h2 a").first().text() || link.attr("title"));
    if (!title) return;
    seen.add(mangaId);

    const rank = Number.parseInt(cleanText(item.find(".ctr").first().text()), 10);
    cards.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(item.find("img").first()),
      rating: cleanText(item.find(".numscore").first().text()) || undefined,
      rank: Number.isFinite(rank) ? rank : undefined,
      genres: item
        .find('a[href*="/genres/"]')
        .toArray()
        .map((genre) => cleanText($(genre).text()))
        .filter((genre) => genre.length > 0),
    });
  });
  return cards;
};

export const parseGenreOptions = ($: cheerio.CheerioAPI): Tag[] => {
  const genres: Tag[] = [];
  const seen = new Set<string>();
  $("ul.genrez li").each((_, element) => {
    const item = $(element);
    const id = (item.find("input[type=checkbox]").attr("value") ?? "").trim();
    const title = cleanText(item.find("label").text());
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    genres.push({ id, title });
  });
  return genres;
};

const collectText = (
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<AnyNode>,
  selector: string,
): string[] => {
  const out: string[] = [];
  scope.find(selector).each((_, element) => {
    const text = cleanText($(element).text());
    if (text && text !== "-" && text.toLowerCase() !== "n/a") out.push(text);
  });
  return out;
};

const parseStatus = (status: string): string => {
  const value = status.toLowerCase();
  if (!value) return "Unknown";
  if (value.includes("complet") || value.includes("finished")) return "Completed";
  if (value.includes("ongoing") || value.includes("publishing") || value.includes("updating")) {
    return "Ongoing";
  }
  if (value.includes("hiatus") || value.includes("hold")) return "Hiatus";
  if (value.includes("cancel") || value.includes("drop")) return "Cancelled";
  return "Unknown";
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const details = $(DETAILS_SCOPE).first();
  const scope: cheerio.Cheerio<AnyNode> = details.length > 0 ? details : $.root();

  const primaryTitle = cleanText(scope.find(TITLE_SELECTOR).first().text()) || mangaId;

  let synopsis = "";
  scope.find(DESC_SELECTOR).each((_, element) => {
    const text = $(element).text().trim();
    if (text) synopsis += (synopsis ? "\n" : "") + text;
  });

  const secondaryTitles = cleanText(scope.find(ALT_NAME_SELECTOR).first().text())
    .split(/[,;|]/)
    .map((title) => title.trim())
    .filter((title) => title.length > 0 && title.toLowerCase() !== primaryTitle.toLowerCase());

  const genreTags: Tag[] = [];
  const seenGenres = new Set<string>();
  scope.find(GENRE_SELECTOR).each((_, element) => {
    const title = cleanText($(element).text());
    if (!title) return;
    const id = sanitizeId(title.toLowerCase().replace(/\s+/g, "-"));
    if (seenGenres.has(id)) return;
    seenGenres.add(id);
    genreTags.push({ id, title });
  });
  const tagGroups: TagSection[] =
    genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : [];

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: imageUrlFrom(scope.find(THUMB_SELECTOR).first()),
      synopsis: Application.decodeHTMLEntities(synopsis),
      author: collectText($, scope, AUTHOR_SELECTOR).join(", ") || undefined,
      artist: collectText($, scope, ARTIST_SELECTOR).join(", ") || undefined,
      status: parseStatus(cleanText(scope.find(STATUS_SELECTOR).first().text())),
      contentRating: contentRatingForGenres(genreTags.map((tag) => tag.title)),
      tagGroups,
      shareUrl: mangaUrl(mangaId),
    },
  };
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  $(CHAPTER_SELECTOR).each((_, element) => {
    const item = $(element);
    const link = item.is("a") ? item : item.find("a").first();
    const chapterId = parseChapterId(link.attr("href"));
    if (!chapterId || seen.has(chapterId)) return;
    seen.add(chapterId);

    const title = cleanText(item.find(CHAPTER_NAME_SELECTOR).first().text() || link.text());
    const number = title.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i) ?? title.match(/(\d+(?:\.\d+)?)/);
    chapters.push({
      chapterId,
      sourceManga,
      title,
      chapNum: number ? Number.parseFloat(number[1]) : 0,
      volume: 0,
      publishDate: parseDate(item.find(CHAPTER_DATE_SELECTOR).first().text()),
      langCode: "en",
    });
  });

  // The site lists newest chapters first.
  return chapters.map((chapter, index) => ({
    ...chapter,
    sortingIndex: chapters.length - index,
  }));
};

export const parseChapterPages = ($: cheerio.CheerioAPI): string[] => {
  const pages: string[] = [];
  $(PAGE_SELECTOR).each((_, element) => {
    const image = imageUrlFrom($(element));
    if (image) pages.push(image);
  });

  if (pages.length === 0) {
    const match = ($.root().html() ?? "").match(IMAGE_LIST_REGEX);
    if (match) {
      let images: unknown;
      try {
        images = JSON.parse(match[1]);
      } catch (error: unknown) {
        throw new Error("Unable to parse reader image list.", { cause: error });
      }
      if (Array.isArray(images)) {
        for (const entry of images) {
          if (typeof entry !== "string") continue;
          const url = toAbsoluteUrl(entry.trim().replace(/\\\//g, "/"));
          if (url) pages.push(url);
        }
      }
    }
  }

  return [...new Set(pages)];
};

export const toPopularFeaturedItem = (card: MangaCard): FeaturedCarouselItem => {
  const infoItems: { symbol: string; text: string }[] = [];
  const chapter = chapterLabel(card.chapter);
  if (chapter) infoItems.push({ symbol: "book.fill", text: chapter });
  if (card.rating) infoItems.push({ symbol: "star.fill", text: card.rating });
  const typeName = card.typeName?.toLowerCase();
  return {
    type: "featuredCarouselItem",
    mangaId: card.mangaId,
    imageUrl: card.imageUrl,
    title: card.title,
    supertitle: typeName ? (TYPE_COUNTRIES[typeName] ?? card.typeName) : undefined,
    infoItems:
      infoItems.length === 0
        ? undefined
        : infoItems.length === 1
          ? [infoItems[0]]
          : [infoItems[0], infoItems[1]],
    contentRating: contentRatingForGenres(card.genres),
  };
};

export const toSimpleItem = (card: MangaCard): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: card.mangaId,
  imageUrl: card.imageUrl,
  title: card.title,
  subtitle:
    [chapterLabel(card.chapter), card.rating ? `★ ${card.rating}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(card.genres),
});

export const toLatestItem = (card: LatestCard): ChapterUpdatesCarouselItem | undefined => {
  if (!card.chapterId) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: card.mangaId,
    chapterId: card.chapterId,
    imageUrl: card.imageUrl,
    title: card.title,
    subtitle: card.chapterName,
    publishDate: card.publishDate,
    contentRating: contentRatingForGenres(card.genres),
  };
};

export const toTrendingResultItem = (card: MangaCard): SearchResultItem => ({
  mangaId: card.mangaId,
  title: card.title,
  imageUrl: card.imageUrl,
  subtitle:
    [card.rank != null ? `#${card.rank}` : undefined, card.rating ? `★ ${card.rating}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(card.genres),
});

export const toSearchResultItem = (card: MangaCard): SearchResultItem => ({
  mangaId: card.mangaId,
  title: card.title,
  imageUrl: card.imageUrl,
  subtitle:
    [chapterLabel(card.chapter), card.rating ? `★ ${card.rating}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: contentRatingForGenres(card.genres),
});
