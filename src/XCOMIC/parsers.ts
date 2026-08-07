/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  DEMOGRAPHIC_OPTIONS,
  DOMAIN,
  FORMAT_OPTIONS,
  GENRE_OPTIONS,
  TYPE_OPTIONS,
  type ChapterData,
  type ComicData,
  type ComicNode,
} from "./models";
import { decryptOpenSslAes } from "./utils";

const absoluteUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const titleCase = (value: string): string =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

// Genre/format/demographic ids share one display vocabulary.
const optionTitle = (id: string): string =>
  GENRE_OPTIONS.find((option) => option.id === id)?.title ??
  DEMOGRAPHIC_OPTIONS.find((option) => option.id === id)?.title ??
  FORMAT_OPTIONS.find((option) => option.id === id)?.title ??
  titleCase(id);

export const toContentRating = (rating?: string | null, sfw?: boolean | null): ContentRating => {
  if (rating === "pornographic") return ContentRating.ADULT;
  if (rating === "erotica") return ContentRating.MATURE;
  if (sfw === false) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const chapterNumber = (chapter?: ChapterData | null): number | undefined => {
  const value = chapter?.chaNum ?? chapter?.serial;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const formatChapter = (chapter?: ChapterData | null): string | undefined => {
  const number = chapterNumber(chapter);
  if (number == null) return undefined;
  return `Ch. ${String(number).replace(/\.0$/, "")}`;
};

const latestChapter = (comic: ComicData): ChapterData | undefined =>
  comic.chapterNodes_last?.[0]?.data;

const dateFromTimestamp = (value?: number | null): Date | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatType = (type?: string | null): string | undefined =>
  type ? (TYPE_OPTIONS.find((option) => option.id === type)?.title ?? titleCase(type)) : undefined;

const imageUrl = (comic: ComicData): string => absoluteUrl(comic.urlCover);

const baseCard = (node: ComicNode) => ({
  mangaId: node.data.id || node.id,
  title: node.data.name,
  imageUrl: imageUrl(node.data),
  contentRating: toContentRating(node.data.contentRating, node.data.sfw_result),
});

const cardSubtitle = (comic: ComicData): string | undefined =>
  [formatChapter(latestChapter(comic)), formatType(comic.type)]
    .filter((value): value is string => Boolean(value))
    .join(" • ") || undefined;

export const toSearchResultItem = (node: ComicNode): SearchResultItem => ({
  ...baseCard(node),
  subtitle: cardSubtitle(node.data),
});

export type CarouselItemType =
  | "featuredCarouselItem"
  | "simpleCarouselItem"
  | "chapterUpdatesCarouselItem";

export const toDiscoverItem = (node: ComicNode, type: CarouselItemType): DiscoverSectionItem => {
  if (type === "featuredCarouselItem") {
    const chapter = formatChapter(latestChapter(node.data));
    return {
      type,
      ...baseCard(node),
      // Type (Manga/Manhwa/…) sits above the title; the chapter number rides a
      // book icon beneath the description.
      supertitle: formatType(node.data.type),
      summary: stripHtml(node.data.summary) || undefined,
      infoItems: chapter ? [{ symbol: "book.fill", text: chapter }] : undefined,
    };
  }
  if (type === "chapterUpdatesCarouselItem") {
    const chapter = latestChapter(node.data);
    // Without a chapter to open, the updates row degrades to a plain card.
    if (chapter?.id) {
      return {
        type,
        ...baseCard(node),
        chapterId: chapter.urlPath ?? chapter.id,
        subtitle: cardSubtitle(node.data),
        publishDate: dateFromTimestamp(
          chapter.dateModify ?? chapter.dateCreate ?? chapter.datePublic,
        ),
      };
    }
    return { type: "simpleCarouselItem", ...baseCard(node), subtitle: cardSubtitle(node.data) };
  }
  return { type, ...baseCard(node), subtitle: cardSubtitle(node.data) };
};

const nodeNames = (nodes?: Array<{ data?: { name?: string } | null } | null> | null): string[] =>
  nodes?.map((node) => node?.data?.name?.trim()).filter((name): name is string => Boolean(name)) ??
  [];

const stripHtml = (html?: string | null): string => {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("br").replaceWith("\n");
  $("p, div, li, blockquote").each((_, element) => {
    $(element).append("\n");
  });
  return Application.decodeHTMLEntities(
    $.root()
      .text()
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
};

const formatDateYmd = (
  value?: {
    y?: number | null;
    m?: number | null;
    d?: number | null;
  } | null,
): string | undefined => {
  if (!value?.y) return undefined;
  return [value.y, value.m?.toString().padStart(2, "0"), value.d?.toString().padStart(2, "0")]
    .filter(Boolean)
    .join("-");
};

export const toSourceManga = (node: ComicNode): SourceManga => {
  const comic = node.data;
  const authors = nodeNames(comic.authorNodes);
  const artists = nodeNames(comic.artistNodes);
  const genres = [...new Set([...(comic.genres ?? []), ...(comic.demographics ?? [])])];
  const tags = comic.tags ?? nodeNames(comic.tagNodes);
  const tagGroups: TagSection[] = [
    {
      id: "genres",
      title: "Genres",
      tags: genres.map((id) => ({ id, title: optionTitle(id) })),
    },
    {
      id: "tags",
      title: "Tags",
      tags: tags.map((id) => ({ id, title: titleCase(id) })),
    },
  ].filter((group) => group.tags.length > 0);

  const publicationFrom = formatDateYmd(comic.originalPubFrom);
  const publicationTill = formatDateYmd(comic.originalPubTill);
  const rating =
    typeof comic.score_val === "number" && Number.isFinite(comic.score_val)
      ? Math.min(1, Math.max(0, comic.score_val / 10))
      : undefined;
  const cover = imageUrl(comic);
  const publishers = nodeNames(comic.publisherNodes);

  return {
    mangaId: comic.id || node.id,
    mangaInfo: {
      primaryTitle: comic.name,
      secondaryTitles: comic.altNames ?? [],
      thumbnailUrl: cover,
      synopsis: stripHtml(comic.summary),
      author: (authors.length > 0 ? authors : (comic.authors ?? [])).join(", ") || undefined,
      artist: (artists.length > 0 ? artists : (comic.artists ?? [])).join(", ") || undefined,
      contentRating: toContentRating(comic.contentRating, comic.sfw_result),
      rating,
      status: comic.originalStatus
        ? titleCase(comic.originalStatus)
        : comic.uploadStatus
          ? titleCase(comic.uploadStatus)
          : "Unknown",
      tagGroups,
      artworkUrls: cover ? [cover] : undefined,
      additionalInfo: {
        ...(comic.type ? { Type: formatType(comic.type) ?? comic.type } : {}),
        ...(comic.originalLanguage ? { "Original Language": comic.originalLanguage } : {}),
        ...(comic.translatedLanguage ? { "Translated Language": comic.translatedLanguage } : {}),
        ...(publicationFrom
          ? {
              Publication: publicationTill
                ? `${publicationFrom} – ${publicationTill}`
                : publicationFrom,
            }
          : {}),
        ...(comic.originalPubZone ? { Region: comic.originalPubZone } : {}),
        ...(typeof comic.chaps_normal === "number" ? { Chapters: String(comic.chaps_normal) } : {}),
        ...(typeof comic.follows === "number" ? { Follows: String(comic.follows) } : {}),
        ...(typeof comic.reviews === "number" ? { Reviews: String(comic.reviews) } : {}),
        ...(publishers.length > 0 ? { Publishers: publishers.join(", ") } : {}),
      },
      shareUrl: absoluteUrl(comic.urlPath || `/comic/${comic.id}`),
    },
  };
};

export const toChapter = (data: ChapterData, sourceManga: SourceManga): Chapter => {
  const number = chapterNumber(data) ?? 0;
  const title = [data.dname?.trim(), data.title?.trim()]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => index === 0 || value !== values[0])
    .join(": ");
  const scanlators = nodeNames(data.groupNodes);
  const uploader = data.userNode?.data?.name?.trim();
  const language = sourceManga.mangaInfo.additionalInfo?.["Translated Language"];
  const langCode =
    typeof language === "string" && language
      ? language === "_t"
        ? "und"
        : language.replaceAll("_", "-")
      : "en";

  return {
    // Prefer the chapter's own path: the /comic/chapter/<id> route the bare id
    // builds does not resolve for every chapter, so a missing urlPath is the
    // only time we fall back to it.
    chapterId: data.urlPath ?? data.id,
    sourceManga,
    chapNum: number,
    volume: typeof data.volNum === "number" && Number.isFinite(data.volNum) ? data.volNum : 0,
    title: title || undefined,
    langCode,
    publishDate: dateFromTimestamp(data.dateModify ?? data.dateCreate ?? data.datePublic),
    version: scanlators.join(", ") || uploader || undefined,
  };
};

const parseImageArray = (script: string): string[] | undefined => {
  const match = /const\s+imgHttps\s*=\s*(\[[\s\S]*?\])\s*;/.exec(script);
  if (!match?.[1]) return undefined;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? (parsed as string[])
      : undefined;
  } catch {
    return undefined;
  }
};

const scriptValue = (script: string, key: string): string =>
  new RegExp(`${key}\\s*=\\s*["']([^"']*)["']`).exec(script)?.[1] ?? "";

export const parseChapterDetails = async (
  html: string,
  chapter: Chapter,
): Promise<ChapterDetails> => {
  const $ = cheerio.load(html);
  const selectors = [
    'div[data-name="image-item"] img[src]',
    'img[src^="/_f/"]',
    'img[src*="/_f/"]',
  ];

  for (const selector of selectors) {
    const pages = $(selector)
      .map((_, element) => absoluteUrl($(element).attr("src")))
      .get()
      .filter(Boolean);
    if (pages.length > 0) {
      return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
    }
  }

  const fallbackPages = $("img[src]")
    .map((_, element) => absoluteUrl($(element).attr("src")))
    .get()
    .filter((url) => /\/_f\/|\/images\/|\.(?:webp|jpe?g)(?:\?|$)/i.test(url));
  if (fallbackPages.length > 0) {
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages: fallbackPages };
  }

  for (const element of $("script").toArray()) {
    const script = $(element).html() ?? "";
    const images = parseImageArray(script);
    if (!images?.length) continue;

    const password = scriptValue(script, "batoPass");
    const encrypted = scriptValue(script, "batoWord");
    let args: string[] = [];
    if (password && encrypted) {
      const decrypted = await decryptOpenSslAes(encrypted, password);
      try {
        const parsed = JSON.parse(decrypted) as unknown;
        if (Array.isArray(parsed)) {
          args = parsed.filter((item): item is string => typeof item === "string");
        }
      } catch {
        args = [];
      }
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: images.map((url, index) => {
        const page = absoluteUrl(url);
        const arg = args[index];
        return arg ? `${page}${page.includes("?") ? "&" : "?"}${arg}` : page;
      }),
    };
  }

  throw new Error("Cannot find chapter images");
};
