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
  type TagSection,
} from "@paperback/types";

import { getBaseUrl } from "./forms/settings";
import {
  type BrowsePage,
  type FilterOption,
  type FilterTaxonomy,
  type HomeSections,
  LOCKED_CHAPTER_PREFIX,
  type ValirChapterData,
  type ValirChapterItem,
  type ValirSeries,
  type ValirSeriesPage,
} from "./models";

// Paperback rejects IDs containing characters outside its allowed set (an
// apostrophe in a tag slug crashes the app), so scrub anything unsupported.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_ID_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

// Page data ships in a Next.js RSC flight stream as escaped JS string literals;
// undo that escaping so JSON values can later be sliced out by their keys.
const decodeFlightPayload = (html: string): string =>
  html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

const sliceBalanced = (payload: string, start: number): string | undefined => {
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
      if (depth === 0) {
        return payload.slice(start, index + 1);
      }
    }
  }
  return undefined;
};

const extractByMarker = <T>(payload: string, marker: string, keepMarker = false): T[] => {
  const values: T[] = [];
  let index = payload.indexOf(marker);
  while (index !== -1) {
    const start = keepMarker ? index : index + marker.length;
    if (payload[start] === "{" || payload[start] === "[") {
      const raw = sliceBalanced(payload, start);
      if (raw !== undefined) {
        try {
          values.push(JSON.parse(raw) as T);
        } catch {
          // The marker also occurs in non-data markup; skip those hits.
        }
      }
    }
    index = payload.indexOf(marker, index + marker.length);
  }
  return values;
};

const isNovel = (series: ValirSeries): boolean =>
  (series.type ?? "").toUpperCase().includes("NOVEL");

// Series URLs are /series/{comic|novel}/{urlSlug}; keeping both parts in the
// manga id lets every endpoint rebuild the URL without extra lookups.
const toMangaId = (series: ValirSeries): string =>
  `${isNovel(series) ? "novel" : "comic"}/${series.urlSlug ?? series.slug}`;

const toAbsoluteUrl = (path: string | null | undefined): string => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${getBaseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
};

const toContentRating = (series: ValirSeries): ContentRating =>
  series.isMature ? ContentRating.MATURE : ContentRating.EVERYONE;

const formatCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
};

const toTitleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

const statSubtitle = (series: ValirSeries, rank?: number): string | undefined => {
  // Ranked carousels lead with the rank number, unranked ones with the rating;
  // both trail with view count. Keeping it to two stats stops the subtitle from
  // overflowing the card.
  const lead =
    rank !== undefined ? `#${rank}` : series.rating ? `★ ${series.rating.toFixed(1)}` : "";
  const parts = [lead, series.viewCount ? `${formatCount(series.viewCount)} views` : ""].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
};

export const parseHomeSections = (html: string): HomeSections => {
  const payload = decodeFlightPayload(html);
  const seriesLists = extractByMarker<ValirSeries[]>(payload, '"series":').filter(
    (list) => Array.isArray(list) && list.length > 0,
  );
  return {
    featured: extractByMarker<ValirSeries[]>(payload, '"initialSlides":')[0] ?? [],
    // The card-stack, updates and new-series components all pass a `series`
    // prop; tell them apart by the fields unique to each item shape.
    editorsPicks:
      seriesLists.find((list) => "viewCount" in list[0] && !("createdAt" in list[0])) ?? [],
    latestUpdates: seriesLists.find((list) => "lastChapterAt" in list[0]) ?? [],
    popularToday: extractByMarker<ValirSeries[]>(payload, '"novels":')[0] ?? [],
    // Ranked cards are emitted in rank order, one `novel` prop per card.
    mostPopular: extractByMarker<ValirSeries>(payload, '"novel":').filter(
      (series) => !!series.slug && !!series.title,
    ),
  };
};

// The filter component holds the full genre/tag lists as flat `{ name, slug }`
// records; match on top-level name+slug to isolate them from nested card data.
export const parseFilterTaxonomy = (html: string): FilterTaxonomy => {
  const payload = decodeFlightPayload(html);
  const pick = (key: string): FilterOption[] =>
    (
      extractByMarker<{ name?: string; slug?: string }[]>(payload, `"${key}":`)
        .filter((list) => Array.isArray(list) && !!list[0]?.name && !!list[0]?.slug)
        .sort((a, b) => b.length - a.length)[0] ?? []
    ).flatMap((entry) =>
      entry.name && entry.slug ? [{ id: sanitizeId(entry.slug), title: entry.name }] : [],
    );
  return { genres: pick("genres"), tags: pick("tags") };
};

export const parseBrowsePage = (html: string): BrowsePage => {
  const payload = decodeFlightPayload(html);
  const series = extractByMarker<ValirSeries[]>(payload, '"initialSeries":')[0];
  if (!series) {
    throw new Error("ValirScans: no series list found in browse page");
  }
  return { series, hasMore: payload.includes('"initialHasMore":true') };
};

export const parseSeriesPage = (html: string): ValirSeriesPage => {
  const payload = decodeFlightPayload(html);
  const page = extractByMarker<ValirSeriesPage>(payload, '{"series":', true).find(
    (candidate) => !!candidate.series?.title && Array.isArray(candidate.chapters),
  );
  if (!page) {
    throw new Error("ValirScans: no series data found — the site layout may have changed");
  }
  return page;
};

export const parseMangaDetails = (page: ValirSeriesPage, mangaId: string): SourceManga => {
  const series = page.series;
  const secondaryTitles = [
    ...new Set(
      [series.altTitle, series.originalTitle, ...(series.aliases ?? [])].filter(
        (title): title is string => !!title && title !== series.title,
      ),
    ),
  ];

  const genres: Tag[] = (series.genres ?? []).flatMap((entry) => {
    const genre = entry.genre ?? entry;
    const title = genre.name ?? (genre.slug ? toTitleCase(genre.slug) : undefined);
    if (!title) return [];
    return [{ id: sanitizeId(genre.slug ?? title), title }];
  });
  const tags: Tag[] = (series.tags ?? [])
    .filter((tag): tag is { name: string; slug?: string } => !!tag.name)
    .map((tag) => ({ id: sanitizeId(tag.slug ?? tag.name), title: tag.name }));

  const tagGroups: TagSection[] = [];
  if (genres.length > 0) tagGroups.push({ id: "genres", title: "Genres", tags: genres });
  if (tags.length > 0) tagGroups.push({ id: "tags", title: "Tags", tags });

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: series.title,
      secondaryTitles,
      thumbnailUrl: toAbsoluteUrl(series.coverImage),
      bannerUrl: series.bannerImage ? toAbsoluteUrl(series.bannerImage) : undefined,
      synopsis: series.description ?? "",
      contentRating: toContentRating(series),
      contentType: isNovel(series) ? "novel" : "comic",
      status: series.status ? toTitleCase(series.status) : undefined,
      author: series.author ?? undefined,
      artist: series.artist ?? undefined,
      rating: series.rating ? Math.min(1, Math.max(0, series.rating / 10)) : undefined,
      tagGroups: tagGroups.length > 0 ? tagGroups : undefined,
      shareUrl: `${getBaseUrl()}/series/${mangaId}`,
    },
  };
};

const chapterTitle = (chapter: ValirChapterItem): string => {
  const title = (chapter.title?.trim() || "")
    .replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "")
    .trim();
  return chapterIsLocked(chapter) ? (title ? `${title} 🔒` : "🔒") : title;
};

const chapterIsLocked = (chapter: ValirChapterItem): boolean => chapter.isLocked === true;

export const parseChapters = (
  seriesPages: ValirSeriesPage[],
  sourceManga: SourceManga,
  showPaidChapters: boolean,
): Chapter[] => {
  const seen = new Set<number>();
  return seriesPages
    .flatMap((page) => page.chapters ?? [])
    .filter((chapter) => showPaidChapters || !chapterIsLocked(chapter))
    .filter((chapter) => {
      if (seen.has(chapter.number)) return false;
      seen.add(chapter.number);
      return true;
    })
    .sort((a, b) => a.number - b.number)
    .map((chapter, index) => ({
      chapterId: chapterIsLocked(chapter)
        ? `${LOCKED_CHAPTER_PREFIX}${chapter.number}`
        : String(chapter.number),
      sourceManga,
      langCode: "en",
      chapNum: chapter.number,
      title: chapterTitle(chapter),
      volume: 0,
      publishDate: chapter.publishedAt ? new Date(chapter.publishedAt) : undefined,
      sortingIndex: index,
    }));
};

// Readium renders novel chapters as XHTML, so unclosed void tags must be
// normalised into their self-closing form first.
const fixVoidElements = (html: string): string =>
  html.replace(/<(br|hr|img|input|meta|link)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/gi, "<$1$2 />");

// Novel prose is a flight text chunk referenced by a pointer
// (e.g. `"content":"$1b"` → row `1b:T<hexlen>,<bytes>`); resolve and slice it.
const resolveContentRef = (payload: string, ref: string): string | undefined => {
  const header = new RegExp(`(?:^|\\n)${ref.slice(1)}:T([0-9a-f]+),`).exec(payload);
  if (!header) return undefined;
  const byteLength = parseInt(header[1], 16);
  const start = header.index + header[0].length;
  let bytes = 0;
  let end = start;
  while (end < payload.length && bytes < byteLength) {
    const code = payload.codePointAt(end) ?? 0;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    end += code > 0xffff ? 2 : 1;
  }
  return payload.slice(start, end);
};

export const parseChapterDetails = (html: string, chapter: Chapter): ChapterDetails => {
  const payload = decodeFlightPayload(html);
  const data = extractByMarker<ValirChapterData>(payload, '"chapter":').find(
    (candidate) => Array.isArray(candidate.pages) || typeof candidate.content === "string",
  );
  if (!data) {
    throw new Error(`ValirScans: no chapter data found for chapter ${chapter.chapterId}`);
  }

  // Novels ship prose in `content`, comics ship image `pages`; prefer the text
  // body so a novel with placeholder page entries still reads as a novel.
  let content = data.content?.trim();
  if (content?.startsWith("$")) {
    content = resolveContentRef(payload, content)?.trim();
  }
  if (content) {
    const body = fixVoidElements(content.replaceAll("&nbsp;", " "));
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`,
    };
  }

  const pages = (data.pages ?? [])
    .slice()
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => toAbsoluteUrl(page.imageUrl))
    .filter((url) => url.length > 0);
  if (pages.length > 0) {
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  throw new Error(`ValirScans: chapter ${chapter.chapterId} has no readable content`);
};

export const toFeaturedItems = (list: ValirSeries[]): DiscoverSectionItem[] =>
  list.map((series) => {
    const rating = series.rating ? { symbol: "star.fill", text: series.rating.toFixed(1) } : null;
    const views = series.viewCount
      ? { symbol: "eye.fill", text: formatCount(series.viewCount) }
      : null;
    const infoItems = [rating, views].filter((item) => item !== null);

    return {
      type: "featuredCarouselItem",
      mangaId: toMangaId(series),
      imageUrl: toAbsoluteUrl(series.coverImage),
      title: series.title,
      supertitle: series.type ? toTitleCase(series.type.replaceAll("_", " ")) : undefined,
      summary: series.description ?? undefined,
      infoItems: (infoItems.length > 0
        ? infoItems
        : undefined) as FeaturedCarouselItem["infoItems"],
      contentRating: toContentRating(series),
    };
  });

export const toCarouselItems = (
  list: ValirSeries[],
  type: "simpleCarouselItem" | "prominentCarouselItem",
  ranked = false,
): DiscoverSectionItem[] =>
  list.map((series, index) => ({
    type,
    mangaId: toMangaId(series),
    imageUrl: toAbsoluteUrl(series.coverImage),
    title: series.title,
    subtitle: statSubtitle(series, ranked ? index + 1 : undefined),
    contentRating: toContentRating(series),
  }));

export const toChapterUpdateItems = (
  list: ValirSeries[],
  wantNovels: boolean,
): DiscoverSectionItem[] =>
  list
    .filter((series) => isNovel(series) === wantNovels)
    .flatMap((series) => {
      // Prefer the newest unlocked chapter so update cards don't lead
      // straight into a paywalled page.
      const chapter = series.chapters?.find((entry) => !chapterIsLocked(entry));
      if (!chapter) return [];
      const date = chapter.publishedAt ?? series.lastChapterAt;
      return [
        {
          type: "chapterUpdatesCarouselItem" as const,
          mangaId: toMangaId(series),
          chapterId: String(chapter.number),
          imageUrl: toAbsoluteUrl(series.coverImage),
          title: series.title,
          // Update cards show the chapter number, not its title text (some
          // chapters carry a name after the number that would read oddly here).
          subtitle: `Chapter ${chapter.number}`,
          publishDate: date ? new Date(date) : undefined,
          contentRating: toContentRating(series),
        },
      ];
    });

export const toSearchResultItem = (series: ValirSeries): SearchResultItem => {
  const subtitle = [
    series.rating ? `★ ${series.rating.toFixed(1)}` : "",
    series.type ? toTitleCase(series.type.replaceAll("_", " ")) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    mangaId: toMangaId(series),
    title: series.title,
    imageUrl: toAbsoluteUrl(series.coverImage),
    subtitle: subtitle.length > 0 ? subtitle : undefined,
    contentRating: toContentRating(series),
  };
};
