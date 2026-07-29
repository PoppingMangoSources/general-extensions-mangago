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
  PAID_CHAPTER_SUFFIX,
  TRENDING_RANGES,
  type BrowseSeries,
  type FeaturedEntry,
  type HomeSections,
  type HomeSeries,
  type SearchMetadata,
  type SeasonChapter,
  type SeriesData,
  type TrendingEntry,
  type TrendingRange,
  type TrendingResponse,
} from "./models";

// Page data lives in a Next.js flight stream: JSON values sit directly in
// stream rows when fetched with the `rsc` header, or inside escaped script
// chunks when a full HTML document is returned. Slice balanced JSON out of
// the text, string-aware so braces inside values don't desync the scan.
const sliceJson = (payload: string, start: number): string | undefined => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < payload.length; index++) {
    const char = payload[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
      if (depth === 0) return payload.slice(start, index + 1);
    }
  }
  return undefined;
};

const decodeEscaped = (payload: string): string =>
  payload.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

const scanByKey = <T>(
  payload: string,
  key: string,
  matches: (value: T) => boolean,
): T | undefined => {
  const marker = `"${key}":`;
  let index = payload.indexOf(marker);
  while (index !== -1) {
    const start = index + marker.length;
    if (payload[start] === "{" || payload[start] === "[") {
      const raw = sliceJson(payload, start);
      if (raw !== undefined) {
        try {
          const value = JSON.parse(raw) as T;
          if (matches(value)) return value;
        } catch {
          // A key hit inside non-JSON markup; keep scanning.
        }
      }
    }
    index = payload.indexOf(marker, index + marker.length);
  }
  return undefined;
};

// Try the raw flight stream first, then the escaped-script form.
const extractByKey = <T>(
  payload: string,
  key: string,
  matches: (value: T) => boolean,
): T | undefined =>
  scanByKey(payload, key, matches) ?? scanByKey(decodeEscaped(payload), key, matches);

// The /comics stream carries the full directory as its largest array of
// series entries.
export const parseDirectory = (payload: string): BrowseSeries[] => {
  let directory: BrowseSeries[] = [];
  for (const text of [payload, decodeEscaped(payload)]) {
    let index = text.indexOf("[{");
    while (index !== -1) {
      const raw = sliceJson(text, index);
      if (raw !== undefined && raw.length > 40) {
        try {
          const value = JSON.parse(raw) as BrowseSeries[];
          if (
            Array.isArray(value) &&
            value.length > directory.length &&
            value.every((entry) => entry && typeof entry === "object") &&
            value[0].series_slug !== undefined &&
            value[0].title !== undefined
          ) {
            directory = value;
          }
        } catch {
          // Not a data array; keep scanning.
        }
      }
      index = text.indexOf("[{", index + 2);
    }
    if (directory.length > 0) break;
  }
  if (directory.length === 0) {
    throw new Error("Temple Scan: no series directory found — the site layout may have changed");
  }
  return directory;
};

// A long value (e.g. the description) is deduped into its own flight row and
// referenced as "$<row>"; resolve that back to the row's byte-counted text.
const resolveFlightRef = (payload: string, ref: string): string | undefined => {
  for (const text of [payload, decodeEscaped(payload)]) {
    const header = new RegExp(`(?:^|\\n)${ref.slice(1)}:T([0-9a-f]+),`).exec(text);
    if (!header) continue;
    const byteLength = parseInt(header[1], 16);
    const start = header.index + header[0].length;
    let bytes = 0;
    let end = start;
    while (end < text.length && bytes < byteLength) {
      const code = text.codePointAt(end) ?? 0;
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      end += code > 0xffff ? 2 : 1;
    }
    return text.slice(start, end);
  }
  return undefined;
};

export const parseSeriesData = (payload: string, mangaId: string): SeriesData => {
  const data = extractByKey<SeriesData>(
    payload,
    "seriesData",
    (value) => !!value && typeof value === "object" && !!value.title,
  );
  if (!data) {
    throw new Error(`Temple Scan: no details found for ${mangaId}`);
  }
  // A bare "$<row>" description is an unresolved flight reference; resolve it to
  // the real text, or blank it so the pointer never shows as the synopsis.
  if (typeof data.description === "string" && /^\$[0-9a-f]+$/i.test(data.description)) {
    data.description = resolveFlightRef(payload, data.description) ?? "";
  }
  return data;
};

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_ID_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const stripHtml = (html: string): string =>
  Application.decodeHTMLEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " "),
  ).trim();

// Descriptions sometimes end with "#tag" hashtags behind a label word
// ("Tags:", "Keywords:", ...); strip both from the prose.
const cleanDescription = (raw: string): string => {
  const text = raw.includes("#")
    ? raw
        .slice(0, raw.indexOf("#"))
        .replace(/[\w\s]+:?\s*$/, "")
        .trim()
    : raw;
  return stripHtml(text);
};

const formatCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
};

const statusLabel = (status?: string | null): string | undefined => {
  if (!status) return undefined;
  return status === "Canceled" || status === "Dropped" ? "Cancelled" : status;
};

export const toSourceManga = (data: SeriesData, mangaId: string): SourceManga => {
  const description = data.description ?? "";
  const tagTitles = [
    data.badge ?? "",
    data.release_year ? String(data.release_year) : "",
    ...(data.tag_series ?? []).map((wrapper) => wrapper.tag?.name ?? ""),
    ...[...description.matchAll(/#(\w+)/g)].map((match) => match[1]),
  ].filter(Boolean);
  const seen = new Set<string>();
  const tags: Tag[] = tagTitles.flatMap((title) => {
    const id = sanitizeId(title);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, title }];
  });

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: data.title,
      secondaryTitles: data.alternative_names ? [data.alternative_names] : [],
      thumbnailUrl: data.thumbnail ?? "",
      synopsis: cleanDescription(description),
      author: data.author ?? undefined,
      artist: data.studio ?? undefined,
      status: statusLabel(data.status),
      contentRating: ContentRating.ADULT,
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      shareUrl: `${DOMAIN}/comic/${mangaId}`,
    },
  };
};

const chapterNumber = (chapter: SeasonChapter): number => {
  const fromName = (chapter.chapter_name ?? "").match(/(\d+(?:\.\d+)?)/);
  if (fromName) return parseFloat(fromName[1]);
  const fromIndex = parseFloat(String(chapter.index ?? ""));
  return isNaN(fromIndex) ? 0 : fromIndex;
};

const chapterIsPaid = (chapter: SeasonChapter): boolean => (chapter.price ?? 0) > 0;

const chapterTitle = (chapter: SeasonChapter): string => {
  const title = (chapter.chapter_title?.trim() || chapter.chapter_name?.trim() || "")
    .replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "")
    .trim();
  return chapterIsPaid(chapter) ? (title ? `${title} - Locked` : "Locked") : title;
};

export const parseChapters = (
  data: SeriesData,
  sourceManga: SourceManga,
  showPaidChapters: boolean,
): Chapter[] =>
  (data.Season ?? [])
    .flatMap((season) => season.Chapter ?? [])
    .filter((chapter) => chapter.chapter_slug && (showPaidChapters || !chapterIsPaid(chapter)))
    .map((chapter) => ({
      chapterId: `${chapter.chapter_slug}${chapterIsPaid(chapter) ? PAID_CHAPTER_SUFFIX : ""}`,
      sourceManga,
      langCode: "en",
      chapNum: chapterNumber(chapter),
      title: chapterTitle(chapter),
      volume: 0,
      publishDate: chapter.created_at ? new Date(chapter.created_at) : undefined,
    }));

export const parseChapterPages = (payload: string, chapter: Chapter): ChapterDetails => {
  const pages = extractByKey<string[]>(
    payload,
    "pages",
    (value) => Array.isArray(value) && (value.length === 0 || typeof value[0] === "string"),
  );
  if (!pages || pages.length === 0) {
    throw new Error(`Temple Scan: no pages found for chapter ${chapter.chapterId}`);
  }
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};

export const parseHomeSections = (payload: string): HomeSections => ({
  newSeries:
    extractByKey<HomeSeries[]>(
      payload,
      "data",
      (value) =>
        Array.isArray(value) &&
        value.length > 0 &&
        !!value[0]?.series_slug &&
        value[0].Chapter === undefined,
    ) ?? [],
  updates:
    extractByKey<HomeSeries[]>(
      payload,
      "series",
      (value) => Array.isArray(value) && value.length > 0 && Array.isArray(value[0]?.Chapter),
    ) ?? [],
});

export const toNewSeriesItems = (series: HomeSeries[]): DiscoverSectionItem[] =>
  series.map((entry) => ({
    type: "simpleCarouselItem",
    mangaId: entry.series_slug,
    title: entry.title,
    imageUrl: entry.thumbnail ?? "",
    subtitle: entry.badge ?? undefined,
  }));

export const toUpdateItems = (updates: HomeSeries[]): DiscoverSectionItem[] =>
  updates.flatMap((series) => {
    // Prefer the newest free chapter so update cards open something readable.
    const chapter = (series.Chapter ?? []).find((entry) => !chapterIsPaid(entry));
    if (!chapter) return [];
    return [
      {
        type: "chapterUpdatesCarouselItem" as const,
        mangaId: series.series_slug,
        chapterId: chapter.chapter_slug,
        title: series.title,
        imageUrl: series.thumbnail ?? "",
        subtitle: chapterTitle(chapter),
        publishDate: chapter.created_at ? new Date(chapter.created_at) : undefined,
        contentRating: ContentRating.ADULT,
      },
    ];
  });

export const parseFeatured = (response: string): FeaturedEntry[] => {
  let parsed: FeaturedEntry[];
  try {
    parsed = JSON.parse(response) as FeaturedEntry[];
  } catch (error) {
    throw new Error("Temple Scan: could not parse the featured list", { cause: error });
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Temple Scan: the featured response is not a list");
  }
  return parsed.filter((entry) => entry.series_slug && entry.title);
};

export const withFeaturedCovers = (
  entries: FeaturedEntry[],
  directory: BrowseSeries[],
): FeaturedEntry[] => {
  const covers = new Map(directory.map((series) => [series.series_slug, series.thumbnail]));
  return entries.map((entry) => ({
    ...entry,
    thumbnail: covers.get(entry.series_slug),
  }));
};

export const toFeaturedItems = (entries: FeaturedEntry[]): DiscoverSectionItem[] =>
  entries.map((entry) => ({
    type: "featuredCarouselItem",
    mangaId: entry.series_slug,
    title: entry.title,
    // The featured carousel renders one image as both the portrait tile and the
    // card background, so a wide hero banner crops badly. Prefer the protagonist
    // character art, falling back to the portrait cover then the banner.
    imageUrl: entry.protagonist ?? entry.thumbnail ?? entry.banner ?? "",
    supertitle: entry.author ?? undefined,
    summary: cleanDescription(entry.description ?? "") || undefined,
    infoItems: entry.total_views
      ? [{ symbol: "eye.fill", text: formatCount(entry.total_views) }]
      : undefined,
    contentRating: ContentRating.ADULT,
  }));

export const toSearchResultItem = (series: BrowseSeries): SearchResultItem => ({
  mangaId: series.series_slug,
  title: series.title,
  imageUrl: series.thumbnail ?? "",
  subtitle: series.total_views ? `${formatCount(series.total_views)} views` : undefined,
  contentRating: ContentRating.ADULT,
});

export const toTrendingSections = (): DiscoverSectionItem[] =>
  TRENDING_RANGES.map((range) => ({
    type: "genresCarouselItem",
    name: range.title,
    searchQuery: {
      title: "",
      metadata: { trending: range.id } satisfies SearchMetadata,
    },
  }));

export const parseTrending = (response: string, range: TrendingRange): TrendingEntry[] => {
  let parsed: TrendingResponse;
  try {
    parsed = JSON.parse(response) as TrendingResponse;
  } catch (error) {
    throw new Error("Temple Scan: could not parse the trending list", { cause: error });
  }
  const lists: Record<TrendingRange, TrendingEntry[] | undefined> = {
    day: parsed.dayRes,
    week: parsed.weekRes,
    month: parsed.mensualRes,
  };
  return lists[range] ?? [];
};

export const toTrendingItems = (entries: TrendingEntry[]): SearchResultItem[] =>
  entries.map((entry, index) => {
    const views = entry.day_views ?? entry.week_views ?? entry.month_views;
    return {
      mangaId: entry.series_slug,
      title: entry.title,
      imageUrl: entry.thumbnail ?? "",
      subtitle: [`#${index + 1}`, views ? `${formatCount(views)} views` : ""]
        .filter(Boolean)
        .join(" · "),
      contentRating: ContentRating.ADULT,
    };
  });
