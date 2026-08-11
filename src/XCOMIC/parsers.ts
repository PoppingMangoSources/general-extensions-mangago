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

import {
  DEMOGRAPHIC_OPTIONS,
  DOMAIN,
  FORMAT_OPTIONS,
  TYPE_OPTIONS,
  type ChapterData,
  type ChapterPagesResponse,
  type ComicData,
  type ComicNode,
  type LatestUploadsResult,
} from "./models";
import { decodeQwikLoader } from "./utils";

const ADULT_GENRES = new Set(["adult", "hentai", "pornographic", "smut"]);
const MATURE_GENRES = new Set(["ecchi", "erotica", "mature", "yaoi", "yuri"]);
// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

export const toAbsoluteUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const titleCase = (value: string): string =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const optionTitle = (id: string): string =>
  DEMOGRAPHIC_OPTIONS.find((option) => option.id === id)?.title ??
  FORMAT_OPTIONS.find((option) => option.id === id)?.title ??
  titleCase(id);

export const parseGenreOptions = (html: string): Tag[] => {
  const $ = cheerio.load(html);
  const formatIds = new Set(FORMAT_OPTIONS.map((option) => option.id));
  const genres: Tag[] = [];
  const seen = new Set<string>();
  const genrePicker = $("details.group")
    .filter((_, element) => $(element).find("summary").first().text().trim().startsWith("Genres"))
    .first();

  genrePicker.find("div").each((_, element) => {
    const id = $(element).attr(":")?.trim();
    const title = $(element).find("span").first().text().trim();
    if (!id || !title || formatIds.has(id) || seen.has(id)) return;
    seen.add(id);
    genres.push({ id, title: Application.decodeHTMLEntities(title) });
  });

  if (!genres.length) throw new Error("XCOMIC returned no genre filters");
  return genres;
};

const contentRatingForComic = (
  rating?: string | null,
  sfw?: boolean | null,
  genres: string[] = [],
): ContentRating => {
  const normalized = genres.map((genre) => genre.trim().toLowerCase());
  if (rating === "pornographic" || normalized.some((genre) => ADULT_GENRES.has(genre))) {
    return ContentRating.ADULT;
  }
  if (
    rating === "suggestive" ||
    rating === "erotica" ||
    sfw === false ||
    normalized.some((genre) => MATURE_GENRES.has(genre))
  ) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

const chapterNumber = (chapter?: ChapterData | null): number | undefined => {
  const value = chapter?.chaNum ?? chapter?.serial;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const formatChapter = (chapter?: ChapterData | null): string | undefined => {
  const number =
    chapterNumber(chapter) ??
    /(?:chapter|ch\.?)[\s_]*(\d+(?:\.\d+)?)/i.exec(chapter?.dname ?? "")?.[1];
  if (number == null) return undefined;
  return `Ch. ${String(number).replace(/\.0$/, "")}`;
};

const dateFromTimestamp = (value?: number | null): Date | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatType = (type?: string | null): string | undefined =>
  type ? (TYPE_OPTIONS.find((option) => option.id === type)?.title ?? titleCase(type)) : undefined;

const baseCard = (node: ComicNode) => ({
  mangaId: node.data.id.replace(SAFE_ID_REGEX, "-"),
  title: Application.decodeHTMLEntities(node.data.name),
  imageUrl: toAbsoluteUrl(node.data.urlCover),
  contentRating: contentRatingForComic(
    node.data.contentRating,
    node.data.sfw_result,
    node.data.genres ?? [],
  ),
});

const cardSubtitle = (comic: ComicData): string | undefined =>
  [formatChapter(comic.chapterNodes_last?.[0]?.data), formatType(comic.type)]
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

export const toDiscoverItem = (
  node: ComicNode,
  type: CarouselItemType,
): DiscoverSectionItem | undefined => {
  const chapter = node.data.chapterNodes_last?.[0]?.data;
  if (type === "featuredCarouselItem") {
    const number = chapterNumber(chapter);
    return {
      type,
      ...baseCard(node),
      supertitle: formatType(node.data.type),
      summary: stripHtml(node.data.summary?.html) || undefined,
      infoItems: number != null ? [{ symbol: "book.fill", text: String(number) }] : undefined,
    };
  }
  if (type === "chapterUpdatesCarouselItem") {
    if (!chapter?.id) return undefined;
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
  return { type, ...baseCard(node), subtitle: cardSubtitle(node.data) };
};

export const parseLatestUploads = (
  input: string,
): { items: DiscoverSectionItem[]; before?: number } => {
  const root = decodeQwikLoader(input);
  const result = (root as { d?: { result?: LatestUploadsResult } })?.d?.result;
  if (!result || !Array.isArray(result.items)) {
    throw new Error("XCOMIC latest-upload results were missing");
  }

  return {
    items: result.items
      .map(({ comic, chapters }) =>
        toDiscoverItem(
          {
            data: {
              ...comic.data,
              type:
                comic.data.type ??
                TYPE_OPTIONS.find((option) => comic.data.genres?.includes(option.id))?.id,
              chapterNodes_last: chapters,
            },
          },
          "chapterUpdatesCarouselItem",
        ),
      )
      .filter((item): item is DiscoverSectionItem => item !== undefined),
    before:
      typeof result.before === "number" && Number.isFinite(result.before)
        ? result.before
        : undefined,
  };
};

const nodeNames = (nodes?: Array<{ data?: { name?: string } | null } | null> | null): string[] =>
  nodes
    ?.map((node) => node?.data?.name?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => Application.decodeHTMLEntities(name)) ?? [];

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
  const distinctArtists = artists.filter((artist) => !authors.includes(artist));
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
  const cover = toAbsoluteUrl(comic.urlCover);
  const publishers = nodeNames(comic.publisherNodes);

  return {
    mangaId: comic.id.replace(SAFE_ID_REGEX, "-"),
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(comic.name),
      secondaryTitles: (comic.altNames ?? []).map((title) => Application.decodeHTMLEntities(title)),
      thumbnailUrl: cover,
      synopsis: stripHtml(comic.summary?.html),
      author: authors.join(", ") || undefined,
      artist: distinctArtists.join(", ") || undefined,
      contentRating: contentRatingForComic(comic.contentRating, comic.sfw_result, [
        ...(comic.genres ?? []),
        ...(comic.tags ?? []),
      ]),
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
      shareUrl: toAbsoluteUrl(comic.urlPath || `/comic/${comic.id}`),
    },
  };
};

export const toChapter = (data: ChapterData, sourceManga: SourceManga): Chapter => {
  const number = chapterNumber(data) ?? 0;
  const title = [data.dname?.trim(), data.title?.trim()]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => index === 0 || value !== values[0])
    .map((value) => Application.decodeHTMLEntities(value))
    .join(": ");
  const scanlators = nodeNames(data.groupNodes);
  const uploaderName = data.userNode?.data?.name?.trim();
  const uploader = uploaderName ? Application.decodeHTMLEntities(uploaderName) : undefined;
  const language = sourceManga.mangaInfo.additionalInfo?.["Translated Language"];
  const langCode =
    typeof language === "string" && language
      ? language === "_t"
        ? "und"
        : language.replaceAll("_", "-")
      : "en";

  return {
    chapterId: (data.urlPath ?? `/comic/chapter/${data.id}`).replace(SAFE_ID_REGEX, "-"),
    sourceManga,
    chapNum: number,
    volume: 0,
    title: title || undefined,
    langCode,
    publishDate: dateFromTimestamp(data.dateModify ?? data.dateCreate ?? data.datePublic),
    version: scanlators.join(", ") || uploader || undefined,
  };
};

export const parseChapterDetails = (
  response: ChapterPagesResponse,
  chapter: Chapter,
): ChapterDetails => {
  const pages = (response.get_chapterNode?.data?.imageUrls ?? [])
    .map(toAbsoluteUrl)
    .filter(Boolean);
  if (!pages.length) throw new Error("XCOMIC returned no chapter images");
  return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
};
