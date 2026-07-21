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
  type HiveScansChapter,
  type HiveScansChapterData,
  type HiveScansPost,
} from "./models";

export const encodeMangaId = (slug: string): string => {
  return encodeURIComponent(slug).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
};

export const decodeMangaId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const normalizeSearchTerm = (term: string): string => {
  return term
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
};

export const isNovel = (post: Pick<HiveScansPost, "isNovel" | "seriesType">): boolean => {
  return post.isNovel === true || (post.seriesType ?? "").toUpperCase() === "NOVEL";
};

export const mapStatus = (status?: string | null): string => {
  switch ((status ?? "").toUpperCase()) {
    case "ONGOING":
    case "COMING_SOON":
      return "Ongoing";
    case "HIATUS":
      return "Hiatus";
    case "COMPLETED":
    case "MASS_RELEASED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "DROPPED":
      return "Dropped";
    default:
      return "Unknown";
  }
};

export const formatSeriesSubtitle = (type?: string | null, status?: string | null): string => {
  return [type, status]
    .filter((value): value is string => Boolean(value))
    .map((value) =>
      value
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    )
    .join(" • ");
};

const cleanField = (value?: string | null): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed.toLowerCase() === "n/a") return undefined;
  return trimmed;
};

const normalizeCreatorName = (value?: string | null): string | undefined => {
  const cleaned = cleanField(value);
  if (!cleaned) return undefined;

  const normalized = cleaned
    .replace(/\s*\[\s*add(?:\s*,[^\]]*)?\]\s*/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();

  if (!normalized || /^(?:update|updating|tba|unknown)$/i.test(normalized)) {
    return undefined;
  }

  return normalized;
};

export const contentRatingForGenres = (genreNames: string[]): ContentRating => {
  const normalized = genreNames.map((name) => name.trim().toLowerCase());
  if (
    normalized.some(
      (name) => name === "adult" || name === "hentai" || name === "smut" || name === "yaoi",
    )
  ) {
    return ContentRating.ADULT;
  }
  if (normalized.some((name) => name === "ecchi" || name === "mature")) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

const contentRatingForPost = (post: Pick<HiveScansPost, "genres">): ContentRating => {
  return contentRatingForGenres((post.genres ?? []).map((genre) => genre.name));
};

const toPaperbackRating = (value?: number | null): number | undefined => {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value / 10));
};

const stripHtml = (html: string): string => {
  if (!html) return "";
  return Application.decodeHTMLEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
};

const toXhtml = (fragment: string): string => {
  const body = cheerio.load(fragment, null, false).html({ xml: true });
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
};

const seriesTypeTag = (seriesType?: string | null): string | undefined => {
  switch ((seriesType ?? "").toUpperCase()) {
    case "MANGA":
      return "Manga";
    case "MANHUA":
      return "Manhua";
    case "MANHWA":
      return "Manhwa";
    case "NOVEL":
      return "Novel";
    default:
      return undefined;
  }
};

export const parseSearchResults = (posts: HiveScansPost[]): SearchResultItem[] => {
  return posts.map((post) => ({
    mangaId: encodeMangaId(post.slug),
    title: Application.decodeHTMLEntities(post.postTitle),
    imageUrl: post.featuredImage ?? "",
    subtitle: formatSeriesSubtitle(post.seriesType, post.seriesStatus) || undefined,
    contentRating: contentRatingForPost(post),
  }));
};

export const toFeaturedItems = (posts: HiveScansPost[]): DiscoverSectionItem[] => {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => {
      const ratingInfo =
        post.averageRating == null
          ? undefined
          : { symbol: "star.fill" as const, text: post.averageRating.toString() };
      const statusText = mapStatus(post.seriesStatus);
      const statusInfo =
        statusText === "Unknown" ? undefined : { symbol: "book.fill" as const, text: statusText };

      return {
        type: "featuredCarouselItem" as const,
        mangaId: encodeMangaId(post.slug),
        title: Application.decodeHTMLEntities(post.postTitle),
        imageUrl: post.featuredImage ?? "",
        supertitle:
          normalizeCreatorName(post.author) ?? (formatSeriesSubtitle(post.seriesType) || undefined),
        summary: stripHtml(post.postContent ?? "") || undefined,
        infoItems:
          ratingInfo && statusInfo
            ? [ratingInfo, statusInfo]
            : ratingInfo
              ? [ratingInfo]
              : statusInfo
                ? [statusInfo]
                : undefined,
        contentRating: contentRatingForPost(post),
      };
    });
};

export const toHotReleaseItems = (posts: HiveScansPost[]): DiscoverSectionItem[] => {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => {
      const latestChapter = post.chapters?.find((chapter) => chapter.isAccessible === true);
      const subtitle = [
        latestChapter ? `Ch. ${latestChapter.number}` : undefined,
        post.averageRating == null ? undefined : `★ ${post.averageRating}`,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" • ");

      return {
        type: "prominentCarouselItem" as const,
        mangaId: encodeMangaId(post.slug),
        title: Application.decodeHTMLEntities(post.postTitle),
        imageUrl: post.featuredImage ?? "",
        subtitle: subtitle || formatSeriesSubtitle(post.seriesType, post.seriesStatus) || undefined,
        contentRating: contentRatingForPost(post),
      };
    });
};

export const toNovelItems = (posts: HiveScansPost[]): DiscoverSectionItem[] => {
  return posts.filter(isNovel).map((post) => {
    const latestChapter = post.chapters?.find((chapter) => chapter.isAccessible === true);
    const subtitle = [
      latestChapter ? `Ch. ${latestChapter.number}` : undefined,
      post.averageRating == null ? undefined : `★ ${post.averageRating}`,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" • ");

    return {
      type: "prominentCarouselItem",
      mangaId: encodeMangaId(post.slug),
      title: Application.decodeHTMLEntities(post.postTitle),
      imageUrl: post.featuredImage ?? "",
      subtitle: subtitle || formatSeriesSubtitle(post.seriesType, post.seriesStatus) || undefined,
      contentRating: contentRatingForPost(post),
    };
  });
};

export const toLatestUpdateItems = (posts: HiveScansPost[]): DiscoverSectionItem[] => {
  return posts
    .filter((post) => !isNovel(post))
    .flatMap((post): DiscoverSectionItem[] => {
      const latestChapter = post.chapters?.[0];
      if (!latestChapter) return [];

      const timestamp =
        post.lastChapterAddedAt ?? latestChapter.updatedAt ?? latestChapter.createdAt;
      const publishDate = new Date(timestamp);
      const subtitle = [
        `Ch. ${latestChapter.number}`,
        post.averageRating == null ? undefined : `★ ${post.averageRating.toString()}`,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" • ");

      return [
        {
          type: "chapterUpdatesCarouselItem",
          mangaId: encodeMangaId(post.slug),
          chapterId: latestChapter.id.toString(),
          title: Application.decodeHTMLEntities(post.postTitle),
          imageUrl: post.featuredImage ?? "",
          subtitle,
          publishDate: Number.isNaN(publishDate.getTime()) ? undefined : publishDate,
          contentRating: contentRatingForPost(post),
        },
      ];
    });
};

export const parseMangaDetails = (post: HiveScansPost): SourceManga => {
  const primaryTitle = Application.decodeHTMLEntities(post.postTitle);
  const genreNames = [
    seriesTypeTag(post.seriesType),
    ...(post.genres ?? []).map((genre) => genre.name),
  ].filter((name): name is string => Boolean(name));
  const uniqueGenres = [...new Set(genreNames)];

  const secondaryTitles: string[] = [];
  const seenTitles = new Set([primaryTitle.trim().toLowerCase()]);
  for (const rawTitle of post.alternativeTitles?.split(/\s*\/\s*|[,\n]/) ?? []) {
    const title = Application.decodeHTMLEntities(rawTitle.trim());
    const normalized = title.toLowerCase();
    if (!title || seenTitles.has(normalized)) continue;
    seenTitles.add(normalized);
    secondaryTitles.push(title);
  }

  const tags: Tag[] = uniqueGenres.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    title: name,
  }));

  return {
    mangaId: encodeMangaId(post.slug),
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: post.featuredImage ?? "",
      synopsis: stripHtml(post.postContent ?? ""),
      author: normalizeCreatorName(post.author),
      artist: normalizeCreatorName(post.artist),
      status: mapStatus(post.seriesStatus),
      rating: toPaperbackRating(post.averageRating),
      contentRating: contentRatingForPost(post),
      contentType: isNovel(post) ? "novel" : "comic",
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: `${DOMAIN}/series/${post.slug}`,
    },
  };
};

const chapterNumber = (chapter: HiveScansChapter): number => {
  return typeof chapter.number === "number"
    ? chapter.number
    : parseFloat(String(chapter.number)) || 0;
};

const isChapterLocked = (chapter: HiveScansChapter): boolean => {
  return chapter.isLocked === true || chapter.isPermanentlyLocked === true;
};

export const parseChapterList = (
  chapters: HiveScansChapter[],
  sourceManga: SourceManga,
  showLocked: boolean,
): Chapter[] => {
  const visible = chapters.filter((chapter) => {
    if (chapter.chapterStatus && chapter.chapterStatus !== "PUBLIC") return false;
    return chapter.isAccessible === true || (showLocked && isChapterLocked(chapter));
  });

  const sorted = [...visible].sort((a, b) => {
    const diff = chapterNumber(a) - chapterNumber(b);
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return sorted.map((chapter, index) => {
    const realTitle = chapter.title?.trim() ?? "";
    const title = chapter.isAccessible === true ? realTitle : `🔒 ${realTitle}`.trim();

    return {
      chapterId: chapter.id.toString(),
      sourceManga,
      title,
      chapNum: chapterNumber(chapter),
      volume: 0,
      langCode: "en",
      sortingIndex: index,
      publishDate: new Date(chapter.createdAt),
    };
  });
};

export const parseChapterDetails = (
  data: HiveScansChapterData,
  chapter: Chapter,
): ChapterDetails => {
  if (data.isShortLinkLocked) throw new Error("Chapter locked (short link).");
  if (data.isLockedByCoins) throw new Error("Chapter locked — coins required to unlock.");
  if (data.isPermanentlyLocked) throw new Error("Chapter permanently locked.");

  const content = data.content?.trim();
  if (content) {
    return {
      type: "html",
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      html: toXhtml(content),
    };
  }

  const pages = [...(data.images ?? [])]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((image) => image.url.replace(/ /g, "%20"))
    .filter((url) => url.length > 0);

  if (pages.length === 0) {
    throw new Error("No chapter content was returned by HiveScans.");
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};
