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
  LOCK_PREFIX,
  type HiveScansChapter,
  type HiveScansPage,
  type HiveScansPost,
  type OptionItem,
} from "./models";

// ---------------------------------------------------------------------------
// id helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// field helpers
// ---------------------------------------------------------------------------

export function isNovel(post: Pick<HiveScansPost, "isNovel" | "seriesType">): boolean {
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

// ---------------------------------------------------------------------------
// listing parsers
// ---------------------------------------------------------------------------

export function parseSearchResults(posts: HiveScansPost[]): SearchResultItem[] {
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

export function toFeaturedItems(posts: HiveScansPost[]): DiscoverSectionItem[] {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => ({
      type: "featuredCarouselItem" as const,
      mangaId: encodeMangaId(post.slug),
      title: Application.decodeHTMLEntities(post.postTitle),
      imageUrl: post.featuredImage ?? "",
      supertitle: formatSeriesSubtitle(post.seriesType, post.seriesStatus) || undefined,
      contentRating: ContentRating.EVERYONE,
    }));
}

export function toSimpleItems(posts: HiveScansPost[]): DiscoverSectionItem[] {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => ({
      type: "simpleCarouselItem" as const,
      mangaId: encodeMangaId(post.slug),
      title: Application.decodeHTMLEntities(post.postTitle),
      imageUrl: post.featuredImage ?? "",
      subtitle: formatSeriesSubtitle(post.seriesType, post.seriesStatus) || undefined,
      contentRating: ContentRating.EVERYONE,
    }));
}

export function genresToOptions(genres: { id: number; name: string }[]): OptionItem[] {
  return genres.map((genre) => ({ id: genre.id.toString(), value: genre.name.trim() }));
}

// ---------------------------------------------------------------------------
// manga details
// ---------------------------------------------------------------------------

export function parseMangaDetails(post: HiveScansPost): SourceManga {
  const genreNames = [
    seriesTypeTag(post.seriesType),
    ...(post.genres ?? []).map((genre) => genre.name),
  ].filter((name): name is string => Boolean(name));
  const uniqueGenres = [...new Set(genreNames)];

  const secondaryTitles = post.alternativeTitles
    ? post.alternativeTitles
        .split(/[,\n]/)
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
      additionalInfo: { slug: post.slug },
      shareUrl: `${DOMAIN}/series/${post.slug}`,
    },
  };
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

function chapterNumber(chapter: HiveScansChapter): number {
  return typeof chapter.number === "number"
    ? chapter.number
    : parseFloat(String(chapter.number)) || 0;
}

function isChapterLocked(chapter: HiveScansChapter): boolean {
  return chapter.isLocked === true || chapter.isTimeLocked === true;
}

// Visibility rule: keep public chapters that are either accessible, or (when
// the user opts in) locked. Inaccessible chapters are prefixed with a lock
// glyph so they read as paid in the list.
export function parseChapterList(
  chapters: HiveScansChapter[],
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
    const title = chapter.isAccessible ? realTitle : `${LOCK_PREFIX}${realTitle}`.trim();

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

export function parseChapterDetails(data: HiveScansPage, chapter: Chapter): ChapterDetails {
  if (data.isShortLinkLocked) throw new Error("Chapter locked (short link).");
  if (data.isLockedByCoins) throw new Error("Chapter locked — coins required to unlock.");
  if (data.isPermanentlyLocked) throw new Error("Chapter permanently locked.");

  const pages = [...(data.images ?? [])]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((image) => image.url.replace(/ /g, "%20"))
    .filter((url) => url.length > 0);

  if (pages.length === 0) {
    throw new Error("No chapter page data could be parsed from HiveScans for this chapter.");
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
}
