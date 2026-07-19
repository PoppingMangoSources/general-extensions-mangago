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

import {
  DOMAIN,
  type HiveToonsChapter,
  type HiveToonsChapterData,
  type HiveToonsPost,
} from "./models";

export function encodeMangaId(slug: string): string {
  return encodeURIComponent(slug).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function decodeMangaId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
}

export function isNovel(post: Pick<HiveToonsPost, "isNovel" | "seriesType">): boolean {
  return post.isNovel === true || (post.seriesType ?? "").toUpperCase() === "NOVEL";
}

export function mapStatus(status?: string | null): string {
  switch ((status ?? "").toUpperCase()) {
    case "ONGOING":
    case "COMING_SOON":
      return "Ongoing";
    case "COMPLETED":
    case "MASS_RELEASED":
      return "Completed";
    case "CANCELLED":
    case "DROPPED":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function formatSeriesSubtitle(type?: string | null, status?: string | null): string {
  return [type, status]
    .filter((value): value is string => Boolean(value))
    .map((value) =>
      value
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    )
    .join(" • ");
}

function cleanField(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed.toLowerCase() === "n/a") return undefined;
  return trimmed;
}

function stripHtml(html: string): string {
  if (!html) return "";
  return Application.decodeHTMLEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}

function seriesTypeTag(seriesType?: string | null): string | undefined {
  switch ((seriesType ?? "").toUpperCase()) {
    case "MANGA":
      return "Manga";
    case "MANHUA":
      return "Manhua";
    case "MANHWA":
      return "Manhwa";
    default:
      return undefined;
  }
}

export function parseSearchResults(posts: HiveToonsPost[]): SearchResultItem[] {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => ({
      mangaId: encodeMangaId(post.slug),
      title: Application.decodeHTMLEntities(post.postTitle),
      imageUrl: post.featuredImage ?? "",
      subtitle: formatSeriesSubtitle(post.seriesType, post.seriesStatus) || undefined,
      contentRating: ContentRating.EVERYONE,
    }));
}

export function toFeaturedItems(posts: HiveToonsPost[]): DiscoverSectionItem[] {
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
        supertitle: cleanField(post.author) ?? (formatSeriesSubtitle(post.seriesType) || undefined),
        summary: stripHtml(post.postContent ?? "") || undefined,
        infoItems:
          ratingInfo && statusInfo
            ? [ratingInfo, statusInfo]
            : ratingInfo
              ? [ratingInfo]
              : statusInfo
                ? [statusInfo]
                : undefined,
        contentRating: ContentRating.EVERYONE,
      };
    });
}

export function toHotReleaseItems(posts: HiveToonsPost[]): DiscoverSectionItem[] {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => {
      const latestChapter = post.chapters?.[0];
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
        contentRating: ContentRating.EVERYONE,
      };
    });
}

export function toLatestUpdateItems(posts: HiveToonsPost[]): DiscoverSectionItem[] {
  return posts
    .filter((post) => !isNovel(post))
    .flatMap((post): DiscoverSectionItem[] => {
      const latestChapter = post.chapters?.[0];
      if (!latestChapter) return [];

      const timestamp =
        post.lastChapterAddedAt ?? latestChapter.updatedAt ?? latestChapter.createdAt;
      const publishDate = new Date(timestamp);

      return [
        {
          type: "chapterUpdatesCarouselItem",
          mangaId: encodeMangaId(post.slug),
          chapterId: latestChapter.number.toString(),
          title: Application.decodeHTMLEntities(post.postTitle),
          imageUrl: post.featuredImage ?? "",
          subtitle: post.averageRating == null ? undefined : `★ ${post.averageRating.toString()}`,
          publishDate: Number.isNaN(publishDate.getTime()) ? undefined : publishDate,
          contentRating: ContentRating.EVERYONE,
        },
      ];
    });
}

export function parseMangaDetails(post: HiveToonsPost): SourceManga {
  const genreNames = [
    seriesTypeTag(post.seriesType),
    ...(post.genres ?? []).map((genre) => genre.name),
  ].filter((name): name is string => Boolean(name));
  const uniqueGenres = [...new Set(genreNames)];

  const secondaryTitles = post.alternativeTitles
    ? post.alternativeTitles
        .split(/\s+\/\s+|[,\n]/)
        .map((title) => title.trim())
        .filter((title) => title.length > 0)
    : [];

  const tags: Tag[] = uniqueGenres.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    title: name,
  }));

  return {
    mangaId: encodeMangaId(post.slug),
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(post.postTitle),
      secondaryTitles,
      thumbnailUrl: post.featuredImage ?? "",
      synopsis: stripHtml(post.postContent ?? ""),
      author: cleanField(post.author),
      artist: cleanField(post.artist),
      status: mapStatus(post.seriesStatus),
      contentRating: ContentRating.EVERYONE,
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: `${DOMAIN}/series/${post.slug}`,
    },
  };
}

function chapterNumber(chapter: HiveToonsChapter): number {
  return typeof chapter.number === "number"
    ? chapter.number
    : parseFloat(String(chapter.number)) || 0;
}

function isChapterLocked(chapter: HiveToonsChapter): boolean {
  return chapter.isLocked === true || chapter.isTimeLocked === true;
}

export function parseChapterList(
  chapters: HiveToonsChapter[],
  sourceManga: SourceManga,
  showLocked: boolean,
): Chapter[] {
  const visible = chapters.filter((chapter) => {
    if (chapter.chapterStatus !== "PUBLIC") return false;
    return chapter.isAccessible || (showLocked && isChapterLocked(chapter));
  });

  const sorted = [...visible].sort((a, b) => {
    const diff = chapterNumber(a) - chapterNumber(b);
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return sorted.map((chapter, index) => {
    const realTitle = chapter.title?.trim() ?? "";
    const title = chapter.isAccessible ? realTitle : `🔒 ${realTitle}`.trim();

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
}

export function parseChapterDetails(data: HiveToonsChapterData, chapter: Chapter): ChapterDetails {
  if (data.isShortLinkLocked) throw new Error("Chapter locked (short link).");
  if (data.isLockedByCoins) throw new Error("Chapter locked — coins required to unlock.");
  if (data.isPermanentlyLocked) throw new Error("Chapter permanently locked.");

  const pages = [...(data.images ?? [])]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((image) => image.url.replace(/ /g, "%20"))
    .filter((url) => url.length > 0);

  if (pages.length === 0) {
    throw new Error("No chapter pages were returned by HiveToons.");
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
}