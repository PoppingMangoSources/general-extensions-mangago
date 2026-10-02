/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type ChapterUpdatesCarouselItem,
  type FeaturedCarouselItem,
  type GenresCarouselItem,
  type ProminentCarouselItem,
  type SearchResultItem,
  type SimpleCarouselItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { DOMAIN, LANGUAGE_OPTIONS, type MangaCard, type SearchMetadata } from "./models";

const SAFE_ID = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const SERIES_PATH = /^\/series\/\d+\/[a-zA-Z0-9._~-]+$/;
const CHAPTER_PATH = /^\/chapter\/\d+\/\d+$/;
const RATING_NAMES = new Set(["safe", "suggestive", "erotica", "pornographic"]);

const cleanText = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const safePath = (value?: string | null): string =>
  (value ?? "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[?#].*$/, "")
    .replace(SAFE_ID, "-");

export const parseMangaId = (value?: string | null): string => {
  const path = safePath(value);
  return SERIES_PATH.test(path) ? path : "";
};

const parseChapterId = (value?: string | null): string => {
  const path = safePath(value);
  return CHAPTER_PATH.test(path) ? path : "";
};

const absoluteUrl = (value?: string | null, cover = false): string => {
  let path = Application.decodeHTMLEntities(value ?? "").trim();
  if (!path) return "";
  if (path.startsWith("//")) path = `https:${path}`;
  if (!/^https?:\/\//i.test(path)) path = `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;
  if (cover && path.includes("/i/c/")) return `${path.replace(/\?.*$/, "")}?w=720`;
  return path;
};

const ratingFrom = (element: cheerio.Cheerio<AnyNode>): MangaCard["contentRating"] => {
  const exact = cleanText(element.find(".card-trail b, .card-trail strong, .badge").text())
    .toLowerCase()
    .match(/safe|suggestive|erotica|pornographic/)?.[0];
  if (exact && RATING_NAMES.has(exact)) return exact as MangaCard["contentRating"];
  return element.find(".mature-cover, .text-mature").length > 0 ? "erotica" : "safe";
};

export const toContentRating = (rating: MangaCard["contentRating"]): ContentRating => {
  if (rating === "pornographic" || rating === "erotica") return ContentRating.ADULT;
  if (rating === "suggestive") return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const chapterText = (value?: string): string | undefined => {
  if (!value) return undefined;
  const match = value.match(/(?:chapter|chapters|ch\.?|episode|ep\.?)\s*(\d+(?:\.\d+)?)/i);
  return match ? `Ch. ${match[1]}` : undefined;
};

const parseCard = ($: cheerio.CheerioAPI, node: AnyNode): MangaCard | undefined => {
  const element = $(node);
  const titleLink = element.is("a[href^='/series/']")
    ? element
    : element.find("a.card-title[href^='/series/'], a[title][href^='/series/']").first();
  const mangaId = parseMangaId(titleLink.attr("href"));
  if (!mangaId) return undefined;
  const title = cleanText(
    titleLink.attr("title") || titleLink.find(".card-title").text() || titleLink.text(),
  );
  if (!title) return undefined;
  const imageUrl = absoluteUrl(element.find("img[src*='/i/c/']").first().attr("src"), true);
  const status = cleanText(
    element
      .find(".cover-labels span")
      .filter((_, item) => /ongoing|completed|hiatus|cancelled/i.test($(item).text()))
      .first()
      .text(),
  );
  const facts = element.find(".card-facts, [class~='mt-0.5'].flex.flex-wrap").first();
  const typeName = cleanText(
    facts
      .children("span")
      .filter((_, item) => /^(?:Manga|Manhwa|Manhua|OEL|Novel|Other)$/i.test($(item).text().trim()))
      .first()
      .text(),
  );
  const rating = cleanText(
    element.find(".card-rating").first().text() ||
      element.find(".lucide-star").first().closest("span").text(),
  ).match(/\d+(?:\.\d+)?/)?.[0];
  const chapterLink = element.find("a[href^='/chapter/']").last();
  const chapterId = parseChapterId(chapterLink.attr("href"));
  const allText = cleanText(element.text());
  const chapter =
    chapterText(cleanText(chapterLink.text())) ??
    chapterText(cleanText(element.find(".card-chapters").text())) ??
    chapterText(allText);
  const datetime = element.find("time").last().attr("datetime");
  const publishDate = datetime ? new Date(datetime) : undefined;
  return {
    mangaId,
    title,
    imageUrl,
    status: status || undefined,
    typeName: typeName || undefined,
    rating,
    chapter,
    chapterId: chapterId || undefined,
    publishDate: publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate : undefined,
    contentRating: ratingFrom(element),
  };
};

const sectionContainer = ($: cheerio.CheerioAPI, heading: string): cheerio.Cheerio<AnyNode> =>
  $("h2")
    .filter((_, element) => cleanText($(element).text()).toLowerCase() === heading.toLowerCase())
    .first()
    .parent()
    .next();

export const parseHomeCards = ($: cheerio.CheerioAPI, heading: string): MangaCard[] => {
  const container = sectionContainer($, heading);
  const candidates =
    heading === "Popular updates"
      ? container.children("a[href^='/series/']")
      : heading === "Latest releases"
        ? container.find("div.relative.flex:has(a.card-title[href^='/series/'])")
        : container.children(".min-w-0");
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  candidates.each((_, element) => {
    const card = parseCard($, element);
    if (!card || seen.has(card.mangaId)) return;
    seen.add(card.mangaId);
    cards.push(card);
  });
  return cards;
};

export const parseBrowseCards = ($: cheerio.CheerioAPI): MangaCard[] => {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();
  $("a.card-title[href^='/series/']").each((_, link) => {
    const element = $(link).closest("div.relative.flex, div.min-w-0").first();
    const card = parseCard($, element.get(0) ?? link);
    if (!card || seen.has(card.mangaId)) return;
    seen.add(card.mangaId);
    cards.push(card);
  });
  return cards;
};

const cardSubtitle = (card: MangaCard): string | undefined => {
  const parts = [card.chapter, card.rating ? `★ ${card.rating}` : undefined].filter(Boolean);
  return parts.length ? parts.join(" • ") : undefined;
};

export const toFeaturedItem = (card: MangaCard, bookmarked = false): FeaturedCarouselItem => {
  const infoItems: { symbol: string; text: string }[] = [];
  if (card.chapter) infoItems.push({ symbol: "book.fill", text: card.chapter });
  if (bookmarked && card.rating) infoItems.push({ symbol: "star.fill", text: card.rating });
  return {
    type: "featuredCarouselItem",
    mangaId: card.mangaId,
    imageUrl: card.imageUrl,
    title: card.title,
    supertitle: card.status,
    summary: bookmarked ? card.typeName : undefined,
    infoItems: infoItems as FeaturedCarouselItem["infoItems"],
    contentRating: toContentRating(card.contentRating),
  };
};

export const toProminentItem = (card: MangaCard): ProminentCarouselItem => ({
  type: "prominentCarouselItem",
  mangaId: card.mangaId,
  imageUrl: card.imageUrl,
  title: card.title,
  subtitle: cardSubtitle(card),
  contentRating: toContentRating(card.contentRating),
});

export const toSimpleItem = (card: MangaCard): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: card.mangaId,
  imageUrl: card.imageUrl,
  title: card.title,
  subtitle: cardSubtitle(card),
  contentRating: toContentRating(card.contentRating),
});

export const toLatestItem = (card: MangaCard): ChapterUpdatesCarouselItem | undefined => {
  if (!card.chapterId) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: card.mangaId,
    chapterId: card.chapterId,
    imageUrl: card.imageUrl,
    title: card.title,
    subtitle: cardSubtitle(card),
    publishDate: card.publishDate,
    contentRating: toContentRating(card.contentRating),
  };
};

export const toSearchResult = (card: MangaCard): SearchResultItem => ({
  mangaId: card.mangaId,
  title: card.title,
  subtitle: [card.chapter, card.typeName].filter(Boolean).join(" • ") || undefined,
  imageUrl: card.imageUrl,
  contentRating: toContentRating(card.contentRating),
});

const flightData = ($: cheerio.CheerioAPI): string => {
  let output = "";
  $("script").each((_, element) => {
    const script = $(element).html() ?? "";
    const match = script.match(/^self\.__next_f\.push\(\[1,("[\s\S]*")\]\)$/);
    if (!match) return;
    output += JSON.parse(match[1]) as string;
  });
  return output;
};

export const parseGenres = ($: cheerio.CheerioAPI): Tag[] => {
  const payload = flightData($);
  const match = payload.match(/"genres":(\[[^\]]*\])/);
  if (match) {
    try {
      const values = JSON.parse(match[1]) as { name?: unknown }[];
      const genres = values.flatMap(({ name }): Tag[] =>
        typeof name === "string" && name ? [{ id: name, title: name }] : [],
      );
      if (genres.length) return genres;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const genres = new Map<string, Tag>();
  $("a[href^='/genre/']").each((_, element) => {
    const title = cleanText($(element).text());
    if (title) genres.set(title, { id: title, title });
  });
  return [...genres.values()];
};

export const toGenreItem = (genre: Tag): GenresCarouselItem => ({
  type: "genresCarouselItem",
  name: genre.title,
  searchQuery: {
    title: "",
    metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
  },
});

export const hasNextPage = ($: cheerio.CheerioAPI, page: number): boolean =>
  $("a[rel='next']").length > 0 ||
  $("a[href*='page=']")
    .toArray()
    .some((element) => {
      const href = $(element).attr("href") ?? "";
      return new RegExp(`(?:[?&])page=${page + 1}(?:&|$)`).test(href);
    });

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const titleElement = $("h1").first();
  const header = titleElement.parent();
  const primaryTitle = cleanText(titleElement.text());
  if (!primaryTitle) throw new Error(`No title found for ${mangaId}.`);
  const secondaryTitle = cleanText(titleElement.next("div").text());
  const author = cleanText(header.find("a[href^='/author/']").first().text());
  const headerText = cleanText(header.children("div").first().text());
  const status = headerText.match(/Ongoing|Completed|Hiatus|Cancelled/i)?.[0];
  const typeName = headerText.match(/Manga|Manhwa|Manhua|OEL|Novel|Other/i)?.[0];
  const ratingName = headerText.toLowerCase().match(/safe|suggestive|erotica|pornographic/)?.[0] as
    | MangaCard["contentRating"]
    | undefined;
  const rating = Number.parseFloat(
    cleanText($("[class*='score'], [title='Rating']").first().text()).match(/\d+(?:\.\d+)?/)?.[0] ??
      "",
  );
  const tags = new Map<string, string>();
  $("a[href^='/genre/'], a[href^='/tag/']").each((_, element) => {
    const title = cleanText($(element).text());
    if (title) tags.set(title, title);
  });
  const tagGroups: TagSection[] = tags.size
    ? [
        {
          id: "tags",
          title: "Genres & Tags",
          tags: [...tags.values()].map((title) => ({ id: title, title })),
        },
      ]
    : [];
  const synopsisHeading = $("h2")
    .filter((_, element) => cleanText($(element).text()) === "Synopsis")
    .first();
  const synopsis = cleanText(synopsisHeading.parent().find(".prose-text").first().text());
  const thumbnailUrl = absoluteUrl($("[class*='grid-area:cover'] img").first().attr("src"), true);
  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis,
      primaryTitle,
      secondaryTitles: secondaryTitle && secondaryTitle !== primaryTitle ? [secondaryTitle] : [],
      contentRating: toContentRating(ratingName ?? ratingFrom(header)),
      contentType: typeName?.toLowerCase() === "novel" ? "novel" : "comic",
      status,
      artist: author || undefined,
      author: author || undefined,
      rating: Number.isFinite(rating) ? rating : undefined,
      tagGroups,
      shareUrl: `${DOMAIN}${mangaId}`,
    },
  };
};

const chapterNumber = (label: string): number => {
  const match = label.match(
    /(?:chapter|chap|ch|episode|ep|special|bonus|extra|bounus)\.?\s*(-?\d+(?:\.\d+)?)/i,
  );
  return Number.parseFloat(match?.[1] ?? "0") || 0;
};

const chapterTitle = (label: string): string | undefined => {
  if (/^(?:chapter|chap|ch|episode|ep)\.?\s*-?\d+(?:\.\d+)?$/i.test(label)) return undefined;
  const match = label.match(
    /^(?:chapter|chap|ch|episode|ep)\.?\s*-?\d+(?:\.\d+)?\s*[-–—:]\s*(.+)$/i,
  );
  return cleanText(match?.[1] ?? label) || undefined;
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  const links = $(".chapter-box a[href^='/chapter/']");
  links.each((index, element) => {
    const link = $(element);
    const chapterId = parseChapterId(link.attr("href"));
    if (!chapterId || seen.has(chapterId)) return;
    seen.add(chapterId);
    const row = link.parent();
    const label = cleanText(link.find("b").text() || link.text());
    const languageName = row.find("img[aria-label]").first().attr("aria-label") ?? "English";
    const langCode =
      LANGUAGE_OPTIONS.find(({ title }) => title.toLowerCase() === languageName.toLowerCase())
        ?.id ?? "en";
    const version = cleanText(row.find(".ch-src").first().attr("title")?.split(":")[0]);
    const datetime = row.find("time").first().attr("datetime");
    const publishDate = datetime ? new Date(datetime) : undefined;
    chapters.push({
      chapterId,
      sourceManga,
      langCode,
      chapNum: chapterNumber(label),
      title: chapterTitle(label),
      version: version || undefined,
      volume: 0,
      sortingIndex: links.length - index,
      publishDate: publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate : undefined,
    });
  });
  return chapters;
};

const base64Bytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Application.base64Decode(normalized + "===".slice((normalized.length + 3) % 4));
  if (typeof decoded === "string") {
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  return new Uint8Array(decoded);
};

const sealedValue = (payload: string, id: string): string | undefined => {
  const header = new RegExp(`(?:^|\\n)${id}:T([0-9a-f]+),`, "i").exec(payload);
  if (!header || header.index == null) return undefined;
  const start = header.index + header[0].length;
  return payload.slice(start, start + Number.parseInt(header[1], 16));
};

export const parseChapterDetails = async (
  html: string,
  chapterId: string,
  mangaId: string,
): Promise<ChapterDetails> => {
  const $ = cheerio.load(html);
  const payload = flightData($);
  const sealedId = payload.match(/"sealed":"\$([0-9a-f]+)"/i)?.[1];
  const sealed = sealedId ? sealedValue(payload, sealedId) : undefined;
  let hashes: string[] = [];
  if (sealed) {
    const data = base64Bytes(sealed);
    const salt = data.subarray(0, 16);
    const iv = data.subarray(16, 28);
    const encrypted = data.subarray(28);
    const mask = [
      251, 68, 48, 74, 214, 173, 238, 166, 37, 228, 221, 68, 159, 198, 138, 8, 68, 65, 5, 4, 140,
      228, 45, 105, 21, 139, 210, 15, 9, 184, 114, 163,
    ];
    const input = [
      255, 172, 104, 142, 42, 92, 130, 138, 138, 221, 37, 196, 184, 82, 208, 173, 197, 95, 183, 154,
      39, 45, 82, 193, 224, 107, 98, 28, 28, 30, 32, 43,
    ];
    const seed = Uint8Array.from(input, (value, index) => value ^ mask[index]);
    const keyMaterial = new Uint8Array(seed.length + salt.length);
    keyMaterial.set(seed);
    keyMaterial.set(salt, seed.length);
    const digest = await crypto.subtle.digest("SHA-256", keyMaterial);
    const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv).buffer },
      key,
      new Uint8Array(encrypted).buffer,
    );
    const manifest = JSON.parse(Application.arrayBufferToUTF8String(decrypted)) as { p?: unknown };
    if (Array.isArray(manifest.p)) {
      hashes = manifest.p.filter((hash): hash is string => typeof hash === "string" && !!hash);
    }
  }
  if (!hashes.length) {
    const pages = payload.match(/"pages":\[([\s\S]*?)\],"chapters"/)?.[1] ?? "";
    hashes = [...pages.matchAll(/"hash":"([^"]+)"/g)].map((match) => match[1]);
  }
  if (!hashes.length) throw new Error(`No pages found for chapter ${chapterId}.`);
  return {
    id: chapterId,
    mangaId,
    pages: hashes.map((hash) => `${DOMAIN}/i/p/${hash}`),
  };
};
