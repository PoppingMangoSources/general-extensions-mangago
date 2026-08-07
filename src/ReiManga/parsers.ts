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

import { getBaseUrl } from "./forms";
import { ADULT_GENRES, type ApiManga, type FlightChapterList, type FlightImages } from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_ID_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();

// The catalogue addresses a series as "<slug>-<id>"; the API wants the id on
// its own, so it is recovered from the tail rather than tracked separately.
export const mangaIdFor = (manga: ApiManga): string =>
  manga.name_url ? `${manga.name_url}-${manga.id}` : String(manga.id);

export const numericIdFrom = (mangaId: string): string | undefined => /(\d+)$/.exec(mangaId)?.[1];

const tagNames = (values: (string | { name?: string })[] | undefined): string[] =>
  (values ?? [])
    .map((value) => (typeof value === "string" ? value : (value.name ?? "")))
    .map((name) => cleanText(name))
    .filter(Boolean);

// Listing rows carry their genres as one comma-separated string of slugs while
// the detail payload sends objects, so both spellings feed the same list.
const genreNames = (manga: ApiManga): string[] => {
  const named = tagNames(manga.genres);
  if (named.length > 0) return named;
  return (manga.genre_slugs ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean)
    .map((slug) => slug.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()));
};

export const contentRatingFor = (manga: ApiManga): ContentRating => {
  if (manga.is_adult) return ContentRating.ADULT;
  const names = [...genreNames(manga), ...tagNames(manga.tags)].map((name) => name.toLowerCase());
  return names.some((name) => ADULT_GENRES.includes(name))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
};

// Covers are served as webp; only the thumbnail path is ever handed out as png.
export const coverFor = (manga: ApiManga): string => {
  const url = manga.cover_url?.trim();
  if (url) return url.replace(/(\/covers\/\d+\/thumbnail)\.png$/, "$1.webp");
  return `${getBaseUrl()}/covers/${manga.id}/thumbnail.webp`;
};

const numberFrom = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const dateFrom = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.getTime() > Date.now() ? new Date() : date;
};

const compactCount = (value: number | undefined): string | undefined => {
  if (value === undefined || value <= 0) return undefined;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
};

const ratingFor = (manga: ApiManga): number | undefined => {
  const value = numberFrom(manga.rating ?? null);
  return value !== undefined && value > 0 ? value : undefined;
};

const chapterLabel = (manga: ApiManga): string | undefined => {
  const number = numberFrom(manga.chapter_number ?? null);
  return number !== undefined ? `Ch. ${number}` : undefined;
};

export const toFeaturedItem = (manga: ApiManga): DiscoverSectionItem => {
  const rating = ratingFor(manga);
  const genres = genreNames(manga);
  const score = rating ? { symbol: "star.fill" as const, text: rating.toFixed(1) } : undefined;
  const views = compactCount(manga.view_count);
  const eye = views ? { symbol: "eye.fill" as const, text: views } : undefined;

  return {
    type: "featuredCarouselItem",
    mangaId: mangaIdFor(manga),
    imageUrl: coverFor(manga),
    title: cleanText(manga.title ?? manga.name ?? ""),
    supertitle: genres.length > 0 ? genres.join(", ") : undefined,
    summary: manga.description ? cleanText(manga.description) : undefined,
    // The carousel takes at most two info pills.
    infoItems: score && eye ? [score, eye] : score ? [score] : eye ? [eye] : undefined,
    contentRating: contentRatingFor(manga),
  };
};

// `detail` picks what the subtitle leads with, matching how the row is ranked.
export const toSimpleItem = (
  manga: ApiManga,
  detail: "chapter" | "reads" | "rating",
  rank?: number,
): DiscoverSectionItem => {
  const rating = ratingFor(manga);
  const lead =
    detail === "reads"
      ? [chapterLabel(manga), compactCount(manga.recent_reads ?? manga.view_count)]
          .filter(Boolean)
          .join(" • ")
      : detail === "rating"
        ? [rating ? `${rating.toFixed(1)} ★` : undefined, chapterLabel(manga)]
            .filter(Boolean)
            .join(" • ")
        : chapterLabel(manga);
  const subtitle = [rank !== undefined ? `#${rank}` : undefined, lead || undefined]
    .filter(Boolean)
    .join(" • ");

  return {
    type: "simpleCarouselItem",
    mangaId: mangaIdFor(manga),
    imageUrl: coverFor(manga),
    title: cleanText(manga.title ?? manga.name ?? ""),
    subtitle: subtitle || undefined,
    contentRating: contentRatingFor(manga),
  };
};

const relativeTime = (date: Date | undefined): string | undefined => {
  if (!date) return undefined;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const scale: [number, string][] = [
    [31_536_000, "y"],
    [2_592_000, "mo"],
    [604_800, "w"],
    [86_400, "d"],
    [3_600, "h"],
    [60, "m"],
  ];
  for (const [size, suffix] of scale) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix} ago`;
  }
  return "just now";
};

// The updates listing names the newest chapter but never carries its id, and
// the chapter-updates row needs one to open. A simple row keeps the number and
// the age on screen while still leading somewhere that works.
export const toLatestItem = (manga: ApiManga): DiscoverSectionItem => {
  const when = relativeTime(
    dateFrom(manga.release_date ?? manga.chapter_updated_at ?? manga.updated_at),
  );
  const subtitle = [chapterLabel(manga), when].filter(Boolean).join(" • ");

  return {
    type: "simpleCarouselItem",
    mangaId: mangaIdFor(manga),
    imageUrl: coverFor(manga),
    title: cleanText(manga.title ?? manga.name ?? ""),
    subtitle: subtitle || undefined,
    contentRating: contentRatingFor(manga),
  };
};

export const toSearchResultItem = (manga: ApiManga): SearchResultItem => {
  const rating = ratingFor(manga);
  const subtitle = [rating ? `${rating.toFixed(1)} ★` : undefined, chapterLabel(manga)]
    .filter(Boolean)
    .join(" • ");

  return {
    mangaId: mangaIdFor(manga),
    title: cleanText(manga.title ?? manga.name ?? ""),
    imageUrl: coverFor(manga),
    subtitle: subtitle || undefined,
    contentRating: contentRatingFor(manga),
  };
};

export const toSourceManga = (manga: ApiManga, mangaId: string): SourceManga => {
  const genres = genreNames(manga);
  const tags = tagNames(manga.tags);
  const seen = new Set<string>();
  const group = (names: string[]): Tag[] =>
    names.flatMap((name) => {
      const id = sanitizeId(name);
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, title: name }];
    });

  const genreTags = group(genres);
  const tagTags = group(tags);
  const rating = ratingFor(manga);
  const alt = manga.alt_title ? cleanText(manga.alt_title) : "";

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: cleanText(manga.title ?? manga.name ?? ""),
      secondaryTitles: alt
        ? alt
            .split(/[,;|]/)
            .map((value) => value.trim())
            .filter(Boolean)
        : [],
      thumbnailUrl: coverFor(manga),
      synopsis: manga.description ? cleanText(manga.description) : "",
      author: tagNames(manga.authors).join(", ") || undefined,
      status: manga.completed === 1 ? "Completed" : "Ongoing",
      // The site scores out of ten; Paperback wants a 0-1 fraction.
      rating: rating !== undefined ? Math.min(1, Math.max(0, rating / 10)) : undefined,
      contentRating: contentRatingFor(manga),
      tagGroups: [
        ...(genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : []),
        ...(tagTags.length > 0 ? [{ id: "tags", title: "Tags", tags: tagTags }] : []),
      ],
      shareUrl: `${getBaseUrl()}/manga/${mangaId}`,
    },
  };
};

// --- server payload ---------------------------------------------------------

// The route ships its data as escaped string fragments that only form valid
// JSON once concatenated in order.
const decodeFlight = (body: string): string => {
  const pieces: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    try {
      pieces.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      continue;
    }
  }
  // A payload served directly for an rsc request arrives unwrapped.
  return pieces.length > 0 ? pieces.join("") : body;
};

const balancedObject = (text: string, start: number): string | undefined => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      if (inString) escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
};

// Walks back from the key to the nearest object start that parses cleanly and
// still contains it, so the surrounding component tree is skipped.
const extractFlight = <T>(body: string, key: string): T | undefined => {
  const blob = decodeFlight(body);
  const marker = `"${key}":`;
  let from = blob.indexOf(marker);

  while (from >= 0) {
    for (let start = from; start >= 0; start--) {
      if (blob[start] !== "{") continue;
      const slice = balancedObject(blob, start);
      if (!slice || slice.length < marker.length || !slice.includes(marker)) continue;
      try {
        return JSON.parse(slice) as T;
      } catch {
        continue;
      }
    }
    from = blob.indexOf(marker, from + marker.length);
  }
  return undefined;
};

export const parseChapters = (body: string, sourceManga: SourceManga): Chapter[] => {
  const data = extractFlight<FlightChapterList>(body, "chapters");
  const entries = data?.chapters ?? [];

  const chapters = entries.flatMap((entry, index) => {
    if (entry.id === undefined || entry.id === null) return [];
    const name = cleanText(entry.name ?? "");
    const chapNum = numberFrom(/(\d+(?:\.\d+)?)/.exec(name)?.[1] ?? null) ?? entries.length - index;

    return [
      {
        chapterId: String(entry.id),
        sourceManga,
        langCode: "en",
        chapNum,
        title: name && !/^(?:ch\.?|chapter)\s*[\d.]+$/i.test(name) ? name : undefined,
        volume: 0,
        sortingIndex: entries.length - index,
        publishDate: dateFrom(entry.uploadDate ?? entry.updatedAt ?? entry.createdAt),
      },
    ];
  });

  if (chapters.length === 0) {
    throw new Error(`No chapters found for ${sourceManga.mangaId}`);
  }
  return chapters;
};

export const parseChapterPages = (body: string, chapter: Chapter): ChapterDetails => {
  const data = extractFlight<FlightImages>(body, "images");
  const pages = (data?.images ?? [])
    .slice()
    .sort((left, right) => (left.page_number ?? 0) - (right.page_number ?? 0))
    .map((image) => (image.image_url ?? image.url ?? "").trim())
    .filter(Boolean);

  if (pages.length === 0) {
    throw new Error(`No pages found for chapter ${chapter.chapterId}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages: [...new Set(pages)],
  };
};
