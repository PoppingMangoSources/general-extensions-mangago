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
  ADULT_GENRES,
  DOMAIN,
  type LuaBanner,
  type LuaChapter,
  type LuaHomePage,
  type LuaSeries,
  type LuaTrendingItem,
} from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_ID_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

// Slugs double as ids; unusual characters are percent-encoded so the original
// slug can always be recovered for request URLs.
export const encodeSlugId = (slug: string): string =>
  slug.replace(SAFE_ID_REGEX, (char) => encodeURIComponent(char));

export const decodeSlugId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isAdultGenre = (name: string): boolean => ADULT_GENRES.includes(name.trim().toLowerCase());

const cleanText = (value?: string | null): string => {
  if (!value) return "";
  return Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();
};

const cleanDescription = (value?: string | null): string => {
  if (!value) return "";
  return Application.decodeHTMLEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
};

const mapStatus = (status?: string | null): string | undefined => {
  const value = (status ?? "").trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : undefined;
};

const formatCount = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
};

const ratingToUnit = (value?: number | null): number | undefined => {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value / 5));
};

export const tagNames = (series: LuaSeries): string[] =>
  (series.tags ?? [])
    .map((tag) => (typeof tag === "string" ? tag : (tag.name ?? "")))
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

const contentRatingForSeries = (series: LuaSeries): ContentRating =>
  tagNames(series).some(isAdultGenre) ? ContentRating.ADULT : ContentRating.MATURE;

const yearOf = (value?: string | null): string | undefined => {
  const match = (value ?? "").match(/^(\d{4})/);
  return match ? match[1] : undefined;
};

const chapterCount = (
  meta?: { chapters_count?: string | number | null } | null,
): number | undefined => {
  const raw = meta?.chapters_count;
  const parsed = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

// Page data arrives split across script-string chunks with escaped quotes;
// joining the chunks before unescaping keeps embedded arrays parseable.
const flightPayload = (html: string): string =>
  html
    .replace(/"\]\)\s*;?\s*(?:<\/script>\s*<script>\s*)?self\.__next_f\.push\(\[1,\s*"/g, "")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

// Walks a JSON array starting at `from`, tracking string state so brackets
// inside values do not desync the depth counter.
const sliceJsonArray = (text: string, from: number): string | undefined => {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth++;
    else if (char === "]") {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return undefined;
};

const extractArray = <T>(payload: string, key: string): T[] => {
  const marker = `"${key}":[`;
  const start = payload.indexOf(marker);
  if (start === -1) return [];
  const slice = sliceJsonArray(payload, start + marker.length - 1);
  if (!slice) return [];
  try {
    return JSON.parse(slice) as T[];
  } catch {
    return [];
  }
};

// Long strings arrive as row references ("$1d") pointing at a `1d:T<hexlen>,`
// text row elsewhere in the payload; inline values pass through unchanged.
const resolveFlightText = (
  payload: string,
  value: string | null | undefined,
): string | undefined => {
  if (!value) return undefined;
  if (!/^\$[0-9a-f]+$/i.test(value)) return value;

  const marker = `${value.slice(1)}:T`;
  let index = payload.indexOf(marker);
  while (index > 0 && /[0-9a-z]/i.test(payload[index - 1])) {
    index = payload.indexOf(marker, index + 1);
  }
  if (index === -1) return undefined;

  const comma = payload.indexOf(",", index + marker.length);
  if (comma === -1) return undefined;
  const length = parseInt(payload.slice(index + marker.length, comma), 16);
  if (!Number.isFinite(length) || length <= 0) return undefined;

  // The declared length counts bytes of the raw stream; cut at the next row
  // boundary as well so multi-byte text can't bleed into the following row.
  const chunk = payload.slice(comma + 1, comma + 1 + length);
  const boundary = chunk.search(/\n[0-9a-f]{1,4}:/i);
  return (boundary === -1 ? chunk : chunk.slice(0, boundary)).trim() || undefined;
};

const resolveSeriesText = (payload: string, series: LuaSeries): LuaSeries => ({
  ...series,
  description: resolveFlightText(payload, series.description) ?? null,
});

export const parseHomePage = (html: string): LuaHomePage => {
  const payload = flightPayload(html);
  return {
    banners: extractArray<LuaBanner>(payload, "banners").map((banner) => ({
      ...banner,
      series: banner.series ? resolveSeriesText(payload, banner.series) : banner.series,
    })),
    recommended: extractArray<LuaSeries>(payload, "series").map((series) =>
      resolveSeriesText(payload, series),
    ),
    editors: extractArray<LuaSeries>(payload, "pinned_series").map((series) =>
      resolveSeriesText(payload, series),
    ),
  };
};

export const toPopularItems = (entries: LuaSeries[]): DiscoverSectionItem[] =>
  entries.map((series) => {
    const ratingInfo =
      series.rating == null || !Number.isFinite(series.rating)
        ? undefined
        : { symbol: "star.fill" as const, text: series.rating.toFixed(1) };
    const statusText = mapStatus(series.status);
    const statusInfo = statusText ? { symbol: "book.fill" as const, text: statusText } : undefined;
    const infoItems = [ratingInfo, statusInfo].filter((item): item is NonNullable<typeof item> =>
      Boolean(item),
    );

    return {
      type: "featuredCarouselItem" as const,
      mangaId: encodeSlugId(series.series_slug),
      imageUrl: series.thumbnail ?? "",
      title: cleanText(series.title),
      supertitle: cleanText(series.alternative_names) || undefined,
      summary: cleanDescription(series.description) || undefined,
      infoItems: (infoItems.length > 0 ? infoItems : undefined) as
        | FeaturedCarouselItem["infoItems"]
        | undefined,
      contentRating: contentRatingForSeries(series),
    };
  });

export const toBannerItems = (banners: LuaBanner[]): DiscoverSectionItem[] =>
  banners.flatMap((banner): DiscoverSectionItem[] => {
    const series = banner.series;
    if (!series?.series_slug) return [];
    const views = series.total_views;
    return [
      {
        type: "featuredCarouselItem",
        mangaId: encodeSlugId(series.series_slug),
        imageUrl: banner.banner ?? series.thumbnail ?? "",
        title: cleanText(series.title),
        summary: cleanDescription(series.description) || undefined,
        infoItems:
          views == null
            ? undefined
            : ([
                { symbol: "eye.fill", text: formatCount(views) },
              ] as FeaturedCarouselItem["infoItems"]),
        contentRating: ContentRating.MATURE,
      },
    ];
  });

export const toRecommendedItems = (entries: LuaSeries[]): DiscoverSectionItem[] =>
  entries.map((series) => {
    const subtitle = [
      mapStatus(series.status),
      yearOf(series.created_at),
      cleanText(series.author ?? "") || undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join(" • ");

    return {
      type: "simpleCarouselItem",
      mangaId: encodeSlugId(series.series_slug),
      imageUrl: series.thumbnail ?? "",
      title: cleanText(series.title),
      subtitle: subtitle || undefined,
      contentRating: contentRatingForSeries(series),
    };
  });

const newestChapter = (series: LuaSeries): LuaChapter | undefined =>
  [...(series.free_chapters ?? []), ...(series.paid_chapters ?? [])].sort(
    (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
  )[0];

export const toLatestItems = (entries: LuaSeries[]): DiscoverSectionItem[] =>
  entries.flatMap((series): DiscoverSectionItem[] => {
    const chapter = newestChapter(series);
    if (!chapter) return [];
    const publishDate = new Date(chapter.created_at ?? "");

    return [
      {
        type: "chapterUpdatesCarouselItem",
        mangaId: encodeSlugId(series.series_slug),
        chapterId: encodeSlugId(chapter.chapter_slug),
        imageUrl: series.thumbnail ?? "",
        title: cleanText(series.title),
        subtitle: cleanText(chapter.chapter_name ?? "") || undefined,
        publishDate: Number.isNaN(publishDate.getTime()) ? undefined : publishDate,
        contentRating: contentRatingForSeries(series),
      },
    ];
  });

export const toRankedItems = (entries: (LuaTrendingItem | LuaSeries)[]): DiscoverSectionItem[] =>
  entries.map((entry, index) => {
    const chapters = chapterCount(entry.meta);
    const subtitle = [`#${index + 1}`, chapters ? `${chapters} ch` : undefined]
      .filter((part): part is string => Boolean(part))
      .join(" • ");

    return {
      type: "simpleCarouselItem",
      mangaId: encodeSlugId(entry.series_slug),
      imageUrl: entry.thumbnail ?? "",
      title: cleanText(entry.title),
      subtitle,
      contentRating: ContentRating.MATURE,
    };
  });

export const toSearchResultItems = (entries: LuaSeries[]): SearchResultItem[] =>
  entries.map((series) => ({
    mangaId: encodeSlugId(series.series_slug),
    title: cleanText(series.title),
    imageUrl: series.thumbnail ?? "",
    subtitle: mapStatus(series.status),
    contentRating: contentRatingForSeries(series),
  }));

export const parseMangaDetails = (series: LuaSeries): SourceManga => {
  const primaryTitle = cleanText(series.title) || "Untitled";
  const secondaryTitles: string[] = [];
  const seen = new Set([primaryTitle.toLowerCase()]);
  for (const raw of (series.alternative_names ?? "").split(/\s*[,|/]\s*|\n/)) {
    const title = cleanText(raw);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    secondaryTitles.push(title);
  }

  const genres = [...new Set(tagNames(series))];
  const tags: Tag[] = genres.map((name) => ({ id: sanitizeId(name), title: name }));

  const views = series.total_views;
  const additionalInfo =
    views == null || !Number.isFinite(views) ? undefined : { views: formatCount(views) };

  return {
    mangaId: encodeSlugId(series.series_slug),
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: series.thumbnail ?? "",
      synopsis: cleanDescription(series.description),
      author: cleanText(series.author ?? "") || undefined,
      status: mapStatus(series.status),
      rating: ratingToUnit(series.rating),
      contentRating: contentRatingForSeries(series),
      contentType: "comic",
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      additionalInfo,
      shareUrl: `${DOMAIN}/series/${series.series_slug}`,
    },
  };
};

const chapterNumberOf = (chapter: LuaChapter): number => {
  const indexed = parseFloat(chapter.index ?? "");
  if (Number.isFinite(indexed)) return indexed;
  const named = (chapter.chapter_name ?? chapter.chapter_slug).match(/(\d+(?:\.\d+)?)/);
  return named ? parseFloat(named[1]) : 0;
};

export const parseChapterList = (
  series: LuaSeries,
  sourceManga: SourceManga,
  showPaid: boolean,
): Chapter[] => {
  const free = (series.free_chapters ?? []).map((chapter) => ({ chapter, locked: false }));
  const paid = showPaid
    ? (series.paid_chapters ?? []).map((chapter) => ({ chapter, locked: true }))
    : [];

  const sorted = [...free, ...paid].sort(
    (a, b) => chapterNumberOf(a.chapter) - chapterNumberOf(b.chapter),
  );

  return sorted.map(({ chapter, locked }, index) => {
    const title = cleanText(chapter.chapter_title ?? "");
    return {
      chapterId: encodeSlugId(chapter.chapter_slug),
      sourceManga,
      title: locked ? `🔒 ${title}`.trim() : title,
      chapNum: chapterNumberOf(chapter),
      volume: 0,
      langCode: "en",
      sortingIndex: index,
      publishDate: chapter.created_at ? new Date(chapter.created_at) : undefined,
    };
  });
};

export const parseChapterPages = (html: string, chapter: Chapter): ChapterDetails => {
  // Reader pages embed their image list in the page payload under
  // "chapter_data":{"images":[...]}; fall back to DOM <img> sources.
  const payload = flightPayload(html);
  let pages: string[] = [];

  const anchor = payload.indexOf('"chapter_data":');
  const marker = '"images":[';
  const start = payload.indexOf(marker, anchor === -1 ? 0 : anchor);
  if (start !== -1) {
    const slice = sliceJsonArray(payload, start + marker.length - 1);
    if (slice) {
      try {
        pages = (JSON.parse(slice) as unknown[]).filter(
          (url): url is string => typeof url === "string",
        );
      } catch {
        pages = [];
      }
    }
  }

  if (pages.length === 0) {
    const imgRegex = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi;
    let match: RegExpExecArray | null;
    while ((match = imgRegex.exec(payload)) !== null) {
      pages.push(match[1]);
    }
  }

  pages = pages
    .map((url) => url.replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/ /g, "%20"))
    .filter((url) => url.includes("media.luacomic.org") || url.includes("/uploads/series/"));

  if (pages.length === 0) {
    throw new Error(`No pages found for chapter ${chapter.chapterId}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};
