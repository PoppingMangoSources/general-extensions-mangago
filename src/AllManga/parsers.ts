/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  type Chapter,
  type ContentRating,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import {
  DEFAULT_IMAGE_SERVER,
  IMAGE_CDN,
  THUMBNAIL_CDN,
  type ChaptersData,
  type EpisodeInfo,
  type MangaCard,
  type MangaDetail,
  type PagesData,
  type PictureUrl,
} from "./models";

const ABSOLUTE_URL_REGEX = /^https?:\/\//;

// A valid stand-in for entries the API returns without a cover. Carousel and
// search items reject an empty imageUrl, so we always hand back a real URL and
// let the app fall back to its own placeholder when it fails to load.
const THUMBNAIL_FALLBACK = `${THUMBNAIL_CDN}?w=250`;

// ---------------------------------------------------------------------------
// image / field helpers
// ---------------------------------------------------------------------------

export function parseThumbnailUrl(thumb?: string | null): string {
  const trimmed = thumb?.trim();
  if (!trimmed) return THUMBNAIL_FALLBACK;
  if (ABSOLUTE_URL_REGEX.test(trimmed)) return trimmed;
  return `${THUMBNAIL_CDN}${trimmed.replace(/^\//, "")}?w=250`;
}

export function parseStatus(status?: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s.includes("releasing") || s.includes("ongoing")) return "Ongoing";
  if (s.includes("finished") || s.includes("completed")) return "Completed";
  if (s.includes("hiatus")) return "Hiatus";
  if (s.includes("cancel")) return "Cancelled";
  return "Unknown";
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

// Reroute a resolved image URL through the resizing proxy at a fixed width.
export function applyImageQuality(url: string, quality: string): string {
  if (quality === "original") return url;
  const match = url.match(/^https?:\/\/([^#]+)/);
  if (!match) return url;
  return `${IMAGE_CDN}/${match[1]}?w=${quality}`;
}

// ---------------------------------------------------------------------------
// listing parsers
// ---------------------------------------------------------------------------

export function cardToSearchResult(
  card: MangaCard,
  contentRating: ContentRating,
): SearchResultItem {
  return {
    mangaId: card._id,
    title: Application.decodeHTMLEntities(card.englishName || card.name),
    imageUrl: parseThumbnailUrl(card.thumbnail),
    contentRating,
  };
}

// ---------------------------------------------------------------------------
// details
// ---------------------------------------------------------------------------

export function detailToSourceManga(
  mangaId: string,
  detail: MangaDetail,
  contentRating: ContentRating,
): SourceManga {
  const primaryTitle = Application.decodeHTMLEntities(detail.englishName || detail.name);

  const secondaryTitles = new Set<string>();
  if (detail.englishName && detail.name && detail.englishName !== detail.name) {
    secondaryTitles.add(Application.decodeHTMLEntities(detail.name));
  }
  for (const alt of detail.altNames ?? []) {
    const trimmed = alt.trim();
    if (trimmed) secondaryTitles.add(Application.decodeHTMLEntities(trimmed));
  }

  const genreNames = [...(detail.genres ?? []), ...(detail.tags ?? [])]
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
  const seen = new Set<string>();
  const tags: Tag[] = [];
  for (const name of genreNames) {
    const id = name.toLowerCase().replace(/\s+/g, "-");
    if (seen.has(id)) continue;
    seen.add(id);
    tags.push({ id, title: name });
  }

  const author = detail.authors?.[0]?.trim() || undefined;

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles: [...secondaryTitles],
      thumbnailUrl: parseThumbnailUrl(detail.thumbnail),
      synopsis: stripHtml(detail.description ?? ""),
      author,
      artist: author,
      status: parseStatus(detail.status),
      contentRating,
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: `https://allmanga.to/manga/${mangaId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

const CONTAINS_DIGIT = /\d/;

export function buildChapters(sourceManga: SourceManga, data: ChaptersData): Chapter[] {
  const sub = data.manga.availableChaptersDetail?.sub ?? [];

  const infoByNum = new Map<string, EpisodeInfo>();
  for (const info of data.episodeInfos ?? []) {
    infoByNum.set(String(info.episodeIdNum), info);
  }

  const chapters = sub.map((num) => {
    const info = infoByNum.get(num);
    const notes = info?.notes?.trim() ?? "";
    // The API sometimes stores the chapter number itself in `notes`; only use
    // it as a title when it's actually a descriptive name.
    const title = notes && !CONTAINS_DIGIT.test(notes) ? Application.decodeHTMLEntities(notes) : "";
    const rawDate = info?.uploadDates?.sub;
    const publishDate = rawDate ? new Date(rawDate) : undefined;

    return {
      chapterId: num,
      sourceManga,
      title,
      chapNum: parseFloat(num) || 0,
      volume: 0,
      langCode: "en",
      publishDate: publishDate && !isNaN(publishDate.getTime()) ? publishDate : undefined,
    };
  });

  chapters.sort((a, b) => a.chapNum - b.chapNum);
  return chapters.map((chapter, index) => ({ ...chapter, sortingIndex: index }));
}

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

function pictureUrlOf(entry: PictureUrl): string | undefined {
  return typeof entry === "string" ? entry : (entry?.url ?? undefined);
}

export function resolvePageUrls(data: PagesData, quality: string): string[] {
  const edges = data.chapterPages?.edges ?? [];
  if (edges.length === 0) return [];

  // Prefer an edge that either serves absolute image URLs or names its server.
  const edge =
    edges.find((e) => {
      const hasAbsolute = (e.pictureUrls ?? []).some((p) => {
        const url = pictureUrlOf(p);
        return url != null && ABSOLUTE_URL_REGEX.test(url);
      });
      return hasAbsolute || e.pictureUrlHead != null;
    }) ?? edges[0];

  const server = edge.pictureUrlHead;
  const imageDomain = server
    ? ABSOLUTE_URL_REGEX.test(server)
      ? `${server.replace(/\/$/, "")}/`
      : `https://${server.replace(/\/$/, "")}/`
    : DEFAULT_IMAGE_SERVER;

  return (edge.pictureUrls ?? [])
    .map(pictureUrlOf)
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => (ABSOLUTE_URL_REGEX.test(url) ? url : imageDomain + url.replace(/^\//, "")))
    .map((url) => applyImageQuality(url, quality));
}
