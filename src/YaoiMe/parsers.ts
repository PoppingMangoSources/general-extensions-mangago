/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
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

import { DOMAIN, type ChapterGroup, type MangaCard, type SearchMetadata } from "./models";

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

// A tag id is the name percent-encoded, as the site's own /tag/ links carry it, so it passes
// Paperback's id rules and decodes back to the name the browse filters expect. encodeURIComponent
// leaves !'*~ alone, and Paperback rejects them.
const toTagId = (name: string): string =>
  encodeURIComponent(name).replace(
    /[!'*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const fromTagId = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

const toTag = (name: string): Tag => ({ id: toTagId(name), title: name });

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

// The heading sits inside a .section-head row whose next sibling holds the cards; stepping only to
// the heading's parent lands on that row's "See all" link instead.
const sectionContainer = ($: cheerio.CheerioAPI, heading: string): cheerio.Cheerio<AnyNode> => {
  const title = $("h2")
    .filter((_, element) => cleanText($(element).text()).toLowerCase() === heading.toLowerCase())
    .first();
  const head = title.closest(".section-head");
  return (head.length ? head : title.parent()).next();
};

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
    // The outer row first: its text column also carries min-w-0, and the cover is not in it.
    const row = $(link).closest("div.relative.flex");
    const element = row.length ? row : $(link).closest("div.min-w-0");
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
        typeof name === "string" && name ? [toTag(name)] : [],
      );
      if (genres.length) return genres;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const genres = new Map<string, Tag>();
  $("a[href^='/genre/']").each((_, element) => {
    const title = cleanText($(element).text());
    if (title) genres.set(title, toTag(title));
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
  // The credits line reads "Story by A, B · Art by C"; both name lists link to /author/.
  const credits = header.find("a[href^='/author/']").first().parent();
  const [storyHtml = "", artHtml = ""] = (credits.html() ?? "").split(/Art by/i);
  const creditNames = (html: string): string => {
    const $credits = cheerio.load(html, null, false);
    return $credits("a[href^='/author/']")
      .toArray()
      .map((element) => cleanText($credits(element).text()))
      .filter(Boolean)
      .join(", ");
  };
  const artist = creditNames(artHtml);
  const author = creditNames(storyHtml) || artist;
  const headerText = cleanText(header.children("div").first().text());
  const status = headerText.match(/Ongoing|Completed|Hiatus|Cancelled/i)?.[0];
  const typeName = headerText.match(/Manga|Manhwa|Manhua|OEL|Novel|Other/i)?.[0];
  const ratingName = headerText.toLowerCase().match(/safe|suggestive|erotica|pornographic/)?.[0] as
    | MangaCard["contentRating"]
    | undefined;
  // The score is out of 10, in the number beside its "score" label.
  const rating = Number.parseFloat(
    $("span.text-muted")
      .filter((_, element) => cleanText($(element).text()) === "score")
      .first()
      .prev()
      .text(),
  );
  // Genres and tags filter on separate browse parameters, so they stay in separate groups.
  const tagGroup = (id: string, title: string, prefix: string): TagSection => {
    const names = new Set<string>();
    $(`a[href^='${prefix}']`).each((_, element) => {
      const name = cleanText($(element).text());
      if (name) names.add(name);
    });
    return { id, title, tags: [...names].map(toTag) };
  };
  const tagGroups = [
    tagGroup("genres", "Genres", "/genre/"),
    tagGroup("tags", "Tags", "/tag/"),
  ].filter((group) => group.tags.length > 0);
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
      artist: artist || author || undefined,
      author: author || undefined,
      rating: Number.isFinite(rating) ? rating / 10 : undefined,
      tagGroups,
      shareUrl: `${DOMAIN}${mangaId}`,
    },
  };
};

const NUMBERED_LABEL =
  /^(?:vol(?:ume)?\.?\s*\d+(?:\.\d+)?\s*)?(?:chapter|chap|ch|episode|ep)\.?\s*\d+(?:\.\d+)?/i;

// "Vol.2 Ch.1.5" is only a number and "Ch.5: The Fall" carries a title, but "Ch.17.2-21" is a
// range, so a separator followed by a digit keeps the whole label.
const chapterTitle = (label: string): string | undefined => {
  const prefix = NUMBERED_LABEL.exec(label);
  if (!prefix) return label || undefined;
  const rest = label.slice(prefix[0].length).trim();
  if (!rest) return undefined;
  return /^[-–—:]\s*(\D.*)$/.exec(rest)?.[1] ?? label;
};

// The JSON value opening at start, read past brackets that sit inside strings.
const sliceJson = (payload: string, start: number): string | undefined => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < payload.length; index++) {
    const character = payload[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
    } else if (character === "[" || character === "{") {
      depth++;
    } else if (character === "]" || character === "}") {
      depth--;
      if (depth === 0) return payload.slice(start, index + 1);
    }
  }
  return undefined;
};

const isChapterGroup = (value: unknown): value is ChapterGroup => {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<ChapterGroup>;
  return (
    typeof group.label === "string" &&
    typeof group.num === "number" &&
    Array.isArray(group.variants)
  );
};

// The HTML renders only the first rows; the full list, with every upload of each chapter, is the
// chapter component's data in the page payload. Its order is not by number, so chapters sort by
// their number, as the site's own list does.
export const parseChapters = (
  $: cheerio.CheerioAPI,
  sourceManga: SourceManga,
  languages: string[],
): Chapter[] => {
  const payload = flightData($);
  const groupsAt = payload.indexOf('"groups":[{');
  const groupsJson = groupsAt >= 0 ? sliceJson(payload, groupsAt + '"groups":'.length) : undefined;
  if (!groupsJson) throw new Error(`No chapter list found for ${sourceManga.mangaId}.`);
  const sourcesAt = payload.indexOf('"sources":{', groupsAt);
  const sourcesJson =
    sourcesAt >= 0 ? sliceJson(payload, sourcesAt + '"sources":'.length) : undefined;
  let groups: ChapterGroup[];
  let sources: Record<string, string>;
  try {
    groups = (JSON.parse(groupsJson) as unknown[]).filter(isChapterGroup);
    sources = sourcesJson ? (JSON.parse(sourcesJson) as Record<string, string>) : {};
  } catch (error) {
    throw new Error(`Could not read the chapter list for ${sourceManga.mangaId}.`, {
      cause: error,
    });
  }

  return groups.flatMap((group) => {
    const variants = group.variants.filter(
      (variant) =>
        typeof variant?.id === "number" &&
        typeof variant.s === "number" &&
        languages.includes(variant.lang || "en"),
    );
    const uploadsPerSource = new Map<number, number>();
    for (const variant of variants) {
      uploadsPerSource.set(variant.s, (uploadsPerSource.get(variant.s) ?? 0) + 1);
    }
    const numbered = new Map<number, number>();
    const publishDate = group.createdAt ? new Date(group.createdAt) : undefined;
    return variants.map((variant): Chapter => {
      const key = sources[variant.s] ?? "";
      const name = key.charAt(0).toUpperCase() + key.slice(1);
      const occurrence = (numbered.get(variant.s) ?? 0) + 1;
      numbered.set(variant.s, occurrence);
      // A source with several uploads of one chapter is numbered in the site's order, as it shows.
      const version =
        name && (uploadsPerSource.get(variant.s) ?? 0) > 1 ? `${name} (${occurrence})` : name;
      return {
        chapterId: `/chapter/${variant.s}/${variant.id}`,
        sourceManga,
        langCode: variant.lang || "en",
        chapNum: group.num,
        title: chapterTitle(cleanText(group.label)),
        version: version || undefined,
        volume: 0,
        sortingIndex: group.num,
        publishDate: publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate : undefined,
      };
    });
  });
};

const base64Bytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = Application.base64Decode(normalized + "===".slice((normalized.length + 3) % 4));
  if (typeof decoded === "string") {
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  return new Uint8Array(decoded);
};

// A sealed page list is either inline or a text row ("<id>:T<hex length>,<data>") it points at.
const sealedValue = (payload: string): string | undefined => {
  const value = payload.match(/"sealed":"([^"]+)"/)?.[1];
  if (!value?.startsWith("$")) return value;
  const header = new RegExp(`(?:^|\\n)${value.slice(1)}:T([0-9a-f]+),`, "i").exec(payload);
  if (!header) return undefined;
  const start = header.index + header[0].length;
  return payload.slice(start, start + Number.parseInt(header[1], 16));
};

export interface ReaderPage {
  hashes: string[];
  sealed?: string;
  build?: string;
  scripts: string[];
}

// The page list is sealed in most chapters; its key ships in one of the page's scripts and changes
// with every deploy of the site, so the build id and script list come along to find it.
export const parseReaderPage = (html: string): ReaderPage => {
  const $ = cheerio.load(html);
  const payload = flightData($);
  const pages = payload.match(/"pages":\[([\s\S]*?)\],"chapters"/)?.[1] ?? "";
  // The page's components list their own scripts, where the reader's key lives, before the
  // framework scripts tagged in the head.
  const scripts = new Set<string>();
  for (const match of payload.matchAll(/\/_next\/static\/chunks\/[\w.-]+\.js/g)) {
    scripts.add(match[0]);
  }
  $("script[src^='/_next/static/chunks/']").each((_, element) => {
    scripts.add($(element).attr("src") ?? "");
  });
  return {
    hashes: [...pages.matchAll(/"hash":"([^"]+)"/g)].map((match) => match[1]),
    sealed: sealedValue(payload),
    build: payload.match(/"b":"([^"]+)"/)?.[1],
    scripts: [...scripts].filter(Boolean).map((path) => `${DOMAIN}${path}`),
  };
};

const BYTE_LIST = "(\\d{1,3}(?:,\\d{1,3}){31})";

// The script exports sealKey as a 32-byte list XORed with a mask declared in the same module.
export const parseSealKey = (script: string): string | undefined => {
  const at = script.indexOf('"sealKey"');
  if (at < 0) return undefined;
  const module = script.slice(script.lastIndexOf('"use strict"', at), at + 400);
  const bytes = (list: string) => list.split(",").map(Number);
  const keyList = new RegExp(`"sealKey",0,\\(\\)=>\\w*\\(?\\[${BYTE_LIST}\\]`).exec(module)?.[1];
  if (!keyList) return undefined;
  const maskName = /=>\w+\^(\w+)\[\w+\]/.exec(module)?.[1];
  const maskList = maskName
    ? new RegExp(`\\b${maskName}=\\[${BYTE_LIST}\\]`).exec(module)?.[1]
    : undefined;
  const mask = maskList ? bytes(maskList) : [];
  return bytes(keyList)
    .map((byte, index) => (byte ^ (mask[index] ?? 0)).toString(16).padStart(2, "0"))
    .join("");
};

export const decryptPageList = async (sealed: string, keyHex: string): Promise<string[]> => {
  const data = base64Bytes(sealed);
  const seed = Uint8Array.from(keyHex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  const keyMaterial = new Uint8Array(seed.length + 16);
  keyMaterial.set(seed);
  keyMaterial.set(data.subarray(0, 16), seed.length);
  const digest = await crypto.subtle.digest("SHA-256", keyMaterial);
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(data.subarray(16, 28)).buffer },
    key,
    new Uint8Array(data.subarray(28)).buffer,
  );
  const manifest = JSON.parse(Application.arrayBufferToUTF8String(decrypted)) as { p?: unknown };
  return Array.isArray(manifest.p)
    ? manifest.p.filter((hash): hash is string => typeof hash === "string" && !!hash)
    : [];
};

export const toPageUrls = (hashes: string[]): string[] =>
  hashes.map((hash) => `${DOMAIN}/i/p/${hash}`);
