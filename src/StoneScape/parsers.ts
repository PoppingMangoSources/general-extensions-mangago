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

import {
  DOMAIN,
  type ChapterPagesResponse,
  type ContentType,
  type MangaListItem,
  type NovelChapterResponse,
  type Series,
  type SeriesChapterDetails,
} from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const LOCKED_PREFIX = "locked:";
const NOVEL_PREFIX = "novel:";

export const encodeMangaId = (slug: string): string => slug.replace(SAFE_ID_REGEX, "-");

export const decodeMangaId = (mangaId: string): string => {
  try {
    return decodeURIComponent(mangaId);
  } catch {
    return mangaId;
  }
};

export const toAbsoluteUrl = (value?: string | null): string => {
  const path = (value ?? "").trim();
  if (!path) return "";
  const absolute = (
    path.startsWith("http://") || path.startsWith("https://")
      ? path
      : path.startsWith("//")
        ? `https:${path}`
        : `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`
  ).replace(/(\.(?:avif|gif|jpe?g|jxl|png|svg|webp))\/+(?=([?#]|$))/i, "$1");
  return /^https?:\/\/[^/\s?#]+(?:[/?#]|$)/i.test(absolute) ? absolute : "";
};

const imageUrl = (...values: (string | null | undefined)[]): string => {
  for (const value of values) {
    const url = toAbsoluteUrl(value);
    if (url) return url;
  }
  return "";
};

const decodeText = (value?: string | null): string =>
  Application.decodeHTMLEntities((value ?? "").trim());

const mapStatus = (value?: string | null): string | undefined => {
  switch ((value ?? "").toLowerCase()) {
    case "ongoing":
      return "Ongoing";
    case "completed":
      return "Completed";
    case "hiatus":
      return "Hiatus";
    case "dropped":
    case "cancelled":
      return "Cancelled";
    default:
      return undefined;
  }
};

const parseDate = (value?: string | null): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatChapterNumber = (value: string): string => {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number.toString() : value;
};

export const contentRatingForGenres = (genreNames: string[]): ContentRating => {
  const genres = genreNames.map((name) => name.trim().toLowerCase());
  if (
    genres.some(
      (name) =>
        name === "adult" ||
        name === "hentai" ||
        name === "shotacon" ||
        name === "smut" ||
        name === "yaoi",
    )
  ) {
    return ContentRating.ADULT;
  }
  if (genres.some((name) => name === "ecchi" || name === "gore" || name === "mature")) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

const formatViews = (views?: number): string | undefined => {
  if (views == null || !Number.isFinite(views)) return undefined;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1).replace(/\.0$/, "")}K views`;
  return `${views} views`;
};

export const parseMangaList = (series: Series[]): MangaListItem[] =>
  series.map((item) => {
    const contentType = item.contentType === "novel" ? "novel" : "manhwa";
    const views =
      item.totalViews == null ? undefined : Number.parseInt(String(item.totalViews), 10);
    return {
      mangaId: encodeMangaId(item.slug),
      title: decodeText(item.title),
      imageUrl: imageUrl(item.coverUrl, item.bannerUrl),
      summary: decodeText(item.description) || undefined,
      author: decodeText(item.author) || undefined,
      status: mapStatus(item.publicationStatus),
      rating:
        item.averageRating == null || !Number.isFinite(item.averageRating)
          ? undefined
          : item.averageRating,
      views: views != null && Number.isFinite(views) ? views : undefined,
      contentRating: contentRatingForGenres(item.genres ?? []),
      contentType,
    };
  });

export const toFeaturedItem = (item: MangaListItem): DiscoverSectionItem => {
  const ratingInfo =
    item.rating == null
      ? undefined
      : { symbol: "star.fill" as const, text: item.rating.toFixed(1) };
  const views = formatViews(item.views);
  const viewsInfo = views ? { symbol: "eye.fill" as const, text: views } : undefined;

  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    title: item.title,
    imageUrl: item.imageUrl,
    supertitle: item.status,
    summary: item.summary,
    infoItems:
      ratingInfo && viewsInfo
        ? ([ratingInfo, viewsInfo] as const)
        : ratingInfo
          ? ([ratingInfo] as const)
          : viewsInfo
            ? ([viewsInfo] as const)
            : undefined,
    contentRating: item.contentRating,
  };
};

export const toSearchResultItem = (item: MangaListItem): SearchResultItem => {
  const subtitle = [
    item.status,
    item.rating == null ? undefined : `Rating ${item.rating.toFixed(1)}`,
    formatViews(item.views),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" • ");
  return {
    mangaId: item.mangaId,
    title: item.title,
    imageUrl: item.imageUrl,
    subtitle: subtitle || undefined,
    contentRating: item.contentRating,
  };
};

export const encodeNovelChapterId = (slug: string, chapterNumber: string): string =>
  `${NOVEL_PREFIX}${encodeMangaId(slug)}:${formatChapterNumber(chapterNumber)}`.replace(
    SAFE_ID_REGEX,
    "-",
  );

export const toChapterUpdateItem = (
  series: Series,
  contentType: ContentType,
): DiscoverSectionItem | undefined => {
  const chapter = series.latestChapter;
  if (!chapter?.chapterId || !chapter.chapterNumber) return undefined;
  const publishDate = parseDate(chapter.createdAt ?? series.lastChapterUploadedAt);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: encodeMangaId(series.slug),
    chapterId:
      contentType === "novel"
        ? encodeNovelChapterId(series.slug, chapter.chapterNumber)
        : chapter.chapterId.replace(SAFE_ID_REGEX, "-"),
    title: decodeText(series.title),
    imageUrl: imageUrl(series.coverUrl, series.bannerUrl),
    subtitle: `Ch. ${formatChapterNumber(chapter.chapterNumber)}`,
    publishDate,
    contentRating: contentRatingForGenres(series.genres ?? []),
  };
};

const cleanCreator = (value?: string | null): string | undefined => {
  const cleaned = decodeText(value);
  if (!cleaned || cleaned === "-" || /^(?:n\/a|unknown|tba)$/i.test(cleaned)) return undefined;
  return cleaned;
};

export const parseMangaDetails = (series: Series): SourceManga => {
  const primaryTitle = decodeText(series.title);
  const originalTitle = decodeText(series.originalTitle);
  const genres = series.genres ?? [];
  const tags: Tag[] = genres.map((genre) => ({
    id: genre.replace(SAFE_ID_REGEX, "-"),
    title: genre
      .replace(/[-_]/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (character) => character.toUpperCase()),
  }));
  const thumbnailUrl = imageUrl(series.coverUrl, series.bannerUrl);
  if (!thumbnailUrl) throw new Error(`No valid cover was returned for ${series.slug}.`);

  return {
    mangaId: encodeMangaId(series.slug),
    mangaInfo: {
      primaryTitle,
      secondaryTitles:
        originalTitle && originalTitle.toLowerCase() !== primaryTitle.toLowerCase()
          ? [originalTitle]
          : [],
      thumbnailUrl,
      synopsis: decodeText(series.description),
      author: cleanCreator(series.author),
      artist: cleanCreator(series.artist),
      status: mapStatus(series.publicationStatus),
      rating:
        series.averageRating == null || !Number.isFinite(series.averageRating)
          ? undefined
          : Math.min(1, Math.max(0, series.averageRating / 5)),
      contentRating: contentRatingForGenres(genres),
      contentType: series.contentType === "novel" ? "novel" : "comic",
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: `${DOMAIN}/series/${series.slug}`,
    },
  };
};

const chapterIsLocked = (chapter: SeriesChapterDetails): boolean =>
  (chapter.price ?? 0) > 0 && chapter.isFreeNow !== true && chapter.isPurchased !== true;

export const parseChapterList = (
  chapters: SeriesChapterDetails[],
  sourceManga: SourceManga,
  contentType: ContentType,
  showLocked: boolean,
): Chapter[] =>
  chapters
    .filter((chapter) => showLocked || !chapterIsLocked(chapter))
    .map((chapter) => ({
      chapter,
      number: Number.parseFloat(chapter.chapterNumber),
    }))
    .sort((left, right) => {
      const leftNumber = Number.isFinite(left.number) ? left.number : Number.MAX_SAFE_INTEGER;
      const rightNumber = Number.isFinite(right.number) ? right.number : Number.MAX_SAFE_INTEGER;
      if (leftNumber !== rightNumber) return leftNumber - rightNumber;
      return (
        (parseDate(left.chapter.createdAt)?.getTime() ?? 0) -
        (parseDate(right.chapter.createdAt)?.getTime() ?? 0)
      );
    })
    .map(({ chapter, number }, index) => {
      const locked = chapterIsLocked(chapter);
      const rawTitle = decodeText(chapter.title);
      const chapterId =
        contentType === "novel"
          ? encodeNovelChapterId(decodeMangaId(sourceManga.mangaId), chapter.chapterNumber)
          : chapter.chapterId.replace(SAFE_ID_REGEX, "-");
      return {
        chapterId: locked ? `${LOCKED_PREFIX}${chapterId}` : chapterId,
        sourceManga,
        langCode: "en",
        chapNum: Number.isFinite(number) ? number : index + 1,
        title: locked ? (rawTitle ? `🔒 ${rawTitle}` : "🔒") : rawTitle || undefined,
        version: contentType === "novel" ? "Novel" : undefined,
        volume: 0,
        sortingIndex: index,
        publishDate: parseDate(chapter.releaseDate ?? chapter.createdAt),
      };
    });

export const decodeChapterId = (
  chapterId: string,
): { locked: boolean; novel?: { slug: string; chapterNumber: string }; chapterId?: string } => {
  const locked = chapterId.startsWith(LOCKED_PREFIX);
  const value = locked ? chapterId.slice(LOCKED_PREFIX.length) : chapterId;
  if (value.startsWith(NOVEL_PREFIX)) {
    const separator = value.lastIndexOf(":");
    return {
      locked,
      novel: {
        slug: decodeMangaId(value.slice(NOVEL_PREFIX.length, separator)),
        chapterNumber: value.slice(separator + 1),
      },
    };
  }
  return { locked, chapterId: value };
};

export const parseChapterPages = (
  response: ChapterPagesResponse,
  chapter: Chapter,
): ChapterDetails => {
  const pages = [...(response.pages?.length ? response.pages : (response.images ?? []))]
    .sort(
      (left, right) =>
        (left.pageNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.pageNumber ?? Number.MAX_SAFE_INTEGER),
    )
    .map((page) => toAbsoluteUrl(page.url))
    .filter((url) => /^https?:\/\/\S+$/i.test(url));

  if (pages.length === 0) {
    throw new Error(`No pages were returned for chapter ${chapter.chapterId}.`);
  }
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};

const escapeXhtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const parseNovelChapter = (
  response: NovelChapterResponse,
  chapter: Chapter,
): ChapterDetails => {
  if ((response.price ?? 0) > 0 && response.isFreeNow !== true && response.isPurchased !== true) {
    throw new Error("This chapter must be unlocked on the website before it can be read.");
  }

  const content = response.contentHtml?.trim() ?? "";
  const illustrations = [...(response.illustrations ?? [])]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap((illustration, index) => {
      const url = toAbsoluteUrl(illustration.imageUrl);
      return url ? [`<img src="${escapeXhtml(url)}" alt="Illustration ${index + 1}"/>`] : [];
    })
    .join("");
  if (!content && !illustrations) {
    throw new Error(`No novel content was returned for chapter ${chapter.chapterId}.`);
  }

  const heading = decodeText(response.title) || chapter.title || `Chapter ${chapter.chapNum}`;
  const body = `<h2>${escapeXhtml(heading)}</h2>${response.noteBeforeHtml ?? ""}${content}${
    response.noteAfterHtml ?? ""
  }${illustrations}`;
  const $ = cheerio.load(body, null, false);
  $("img").each((_, image) => {
    const src = $(image).attr("src");
    if (src) $(image).attr("src", toAbsoluteUrl(src));
  });

  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${$.html({
      xml: true,
    })}</body></html>`,
  };
};
