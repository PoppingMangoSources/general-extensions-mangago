/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import {
  ADULT_RATING_GENRES,
  AGGREGATOR_ICON,
  DOMAIN,
  NATIVE_VERSION,
  type ChapterContentResponse,
  type Novel,
  type NovelSource,
  type SourceChapterContentResponse,
  type SourceChapterEntry,
} from "./models";

const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_ID_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const coverOf = (novel: Novel): string => {
  const path = novel.cover_url ?? novel.image_url ?? novel.novel_image;
  if (!path) return "";
  return path.startsWith("http") ? path : `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;
};

const genreList = (novel: Novel): string[] =>
  (novel.genres ?? "")
    .split(",")
    .map((genre) => genre.trim())
    .filter((genre) => genre.length > 0);

const genreLabel = (novel: Novel): string | undefined => {
  const genres = genreList(novel);
  return genres.length > 0 ? genres.join(", ") : undefined;
};

const viewsOf = (novel: Novel): number | undefined => {
  const value = novel.views_number ?? novel.views;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const formatCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
};

const titleCase = (value: string): string =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const statusOf = (novel: Novel): string | undefined => {
  const status = novel.release_status ?? novel.ongoing;
  return status ? titleCase(status.trim()) : undefined;
};

const cleanDescription = (value?: string | null): string => {
  if (!value) return "";
  return Application.decodeHTMLEntities(value)
    .replace(/\s*show more\s*$/i, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
};

const ratingToUnit = (value?: number | null): number | undefined => {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value / 5));
};

const contentRatingForNovel = (novel: Novel): ContentRating => {
  const genres = genreList(novel).map((genre) => genre.toLowerCase());
  return genres.some((genre) => ADULT_RATING_GENRES.includes(genre))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const toFeaturedItems = (
  novels: Novel[],
  variant: "trending" | "editors",
): DiscoverSectionItem[] =>
  novels.map((novel, index) => {
    const views = viewsOf(novel);
    const viewsInfo =
      views === undefined ? undefined : { symbol: "eye.fill", text: formatCount(views) };
    const rankInfo = { symbol: "flame.fill", text: `#${index + 1}` };
    const infoItems =
      variant === "trending"
        ? viewsInfo
          ? [viewsInfo, rankInfo]
          : [rankInfo]
        : viewsInfo
          ? [viewsInfo]
          : undefined;

    return {
      type: "featuredCarouselItem",
      mangaId: String(novel.id),
      imageUrl: coverOf(novel),
      title: novel.title,
      supertitle:
        variant === "trending" ? genreLabel(novel) : index % 2 === 0 ? "Staff Pick" : "Must Read",
      summary: cleanDescription(novel.description) || undefined,
      infoItems: infoItems as FeaturedCarouselItem["infoItems"],
      contentRating: contentRatingForNovel(novel),
    };
  });

export const toCardItems = (
  novels: Novel[],
  variant: "rating" | "chapters",
): DiscoverSectionItem[] =>
  novels.map((novel) => {
    const lead =
      variant === "chapters"
        ? novel.total_chapters
          ? `${novel.total_chapters} ch`
          : undefined
        : novel.rating != null
          ? `★ ${novel.rating.toFixed(1)}`
          : undefined;
    const subtitle = [lead, genreList(novel)[0]]
      .filter((part): part is string => Boolean(part))
      .join(" • ");

    return {
      type: "simpleCarouselItem",
      mangaId: String(novel.id),
      imageUrl: coverOf(novel),
      title: novel.title,
      subtitle: subtitle || undefined,
      contentRating: contentRatingForNovel(novel),
    };
  });

export const toChapterUpdateItems = (novels: Novel[]): DiscoverSectionItem[] =>
  novels.map((novel) => {
    const date = novel.updated_at ? new Date(novel.updated_at) : undefined;
    const subtitle = [
      novel.total_chapters ? `Ch. ${novel.total_chapters}` : undefined,
      genreList(novel)[0],
    ]
      .filter((part): part is string => Boolean(part))
      .join(" • ");
    return {
      type: "chapterUpdatesCarouselItem",
      mangaId: String(novel.id),
      chapterId: String(novel.total_chapters ?? ""),
      imageUrl: coverOf(novel),
      title: novel.title,
      subtitle: subtitle || undefined,
      publishDate: date && !Number.isNaN(date.getTime()) ? date : undefined,
      contentRating: contentRatingForNovel(novel),
    };
  });

export const toSearchResultItem = (novel: Novel): SearchResultItem => {
  const subtitle = [
    novel.rating != null ? `★ ${novel.rating.toFixed(1)}` : undefined,
    genreList(novel)[0],
  ]
    .filter((part): part is string => Boolean(part))
    .join(" • ");

  return {
    mangaId: String(novel.id),
    title: novel.title,
    imageUrl: coverOf(novel),
    subtitle: subtitle || undefined,
    contentRating: contentRatingForNovel(novel),
  };
};

export const parseMangaDetails = (novel: Novel): SourceManga => {
  const primaryTitle = (novel.title ?? "").trim() || "Untitled";
  const seen = new Set([primaryTitle.toLowerCase()]);
  const secondaryTitles: string[] = [];
  for (const alias of novel.associated_names ?? []) {
    const title = (alias ?? "").trim();
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    secondaryTitles.push(title);
  }

  const tags: Tag[] = genreList(novel).map((genre) => ({ id: sanitizeId(genre), title: genre }));

  const percentage = ratingToUnit(novel.rating);
  const additionalInfo =
    percentage === undefined
      ? undefined
      : {
          rating: `${Math.round(percentage * 100)}%${
            novel.rating_count ? ` · ${novel.rating_count} ratings` : ""
          }`,
        };

  return {
    mangaId: String(novel.id),
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: coverOf(novel),
      synopsis: cleanDescription(novel.description),
      author: novel.author?.trim() || undefined,
      artist: novel.author?.trim() || undefined,
      status: statusOf(novel),
      rating: percentage,
      contentRating: contentRatingForNovel(novel),
      contentType: "novel",
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      additionalInfo,
      shareUrl: `${DOMAIN}/novel/${novel.id}`,
    },
  };
};

const CHAPTER_LEAD = /^\s*(?:chapter|chap\.?|ch\.?|episode|ep\.?)?\s*(\d+(?:\.\d+)?)\s*[-:–.]?\s*/i;

const cleanChapterName = (name: string): { chapNum?: number; title: string } => {
  const match = name.match(CHAPTER_LEAD);
  const parsed = match ? parseFloat(match[1]) : NaN;
  const title = (match ? name.slice(match[0].length) : name)
    .replace(/^\d+(?:\.\d+)?\s*[-:–.]\s*/, "")
    .trim();
  return { chapNum: Number.isFinite(parsed) ? parsed : undefined, title };
};

export const parseChapters = (novel: Novel, sourceManga: SourceManga): Chapter[] =>
  (novel.chapter_names ?? []).map((rawName, index) => {
    const { chapNum, title } = cleanChapterName((rawName ?? "").trim());
    const number = chapNum ?? index + 1;
    return {
      chapterId: String(index + 1),
      sourceManga,
      langCode: "en",
      chapNum: number,
      title: title || `Chapter ${number}`,
      version: NATIVE_VERSION,
      volume: 0,
      sortingIndex: index,
    };
  });

export const parseSourceChapters = (
  source: NovelSource,
  entries: SourceChapterEntry[],
  sourceManga: SourceManga,
): Chapter[] =>
  entries.map((entry, index) => {
    const parsed =
      typeof entry.number === "number" ? entry.number : parseFloat(String(entry.number));
    const chapNum = Number.isFinite(parsed) ? parsed : index + 1;
    const { title } = cleanChapterName((entry.title ?? "").trim());
    return {
      chapterId: `${source.id}:${entry.number}`,
      sourceManga,
      langCode: "en",
      chapNum,
      title: title || `Chapter ${chapNum}`,
      version: `${AGGREGATOR_ICON} ${source.label ?? source.id}`,
      volume: 0,
      sortingIndex: index,
    };
  });

const toXhtmlDocument = (text: string): string => {
  const body = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join("");
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
};

const htmlToText = (html: string): string =>
  Application.decodeHTMLEntities(
    html
      .replace(/<\s*(?:br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/\s*(?:p|div|h[1-6]|li|blockquote)\s*>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  );

export const parseChapterDetails = (
  response: ChapterContentResponse,
  chapter: Chapter,
): ChapterDetails => {
  const content = (response.chapter?.content ?? response.content ?? "").trim();
  if (!content) {
    throw new Error(`No content returned for chapter ${chapter.chapterId}`);
  }
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: toXhtmlDocument(content),
  };
};

export const parseSourceChapterDetails = (
  response: SourceChapterContentResponse,
  chapter: Chapter,
): ChapterDetails => {
  const html = (
    response.content_html ??
    response.chapter?.content_html ??
    response.content ??
    ""
  ).trim();
  if (!html) {
    throw new Error(`No content returned for chapter ${chapter.chapterId}`);
  }
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: toXhtmlDocument(htmlToText(html)),
  };
};
