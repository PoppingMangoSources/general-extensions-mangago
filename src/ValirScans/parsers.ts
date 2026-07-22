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

import {
  DOMAIN,
  type HomeSections,
  type ValirChapterData,
  type ValirChapterItem,
  type ValirSeries,
  type ValirSeriesPage,
} from "./models";

// ValirScans is a Next.js App Router site: page data ships as an RSC flight
// stream whose JSON is embedded inside escaped JS string literals. Undo the
// string-literal escaping once, then slice balanced JSON values out of the
// stream anchored by their property keys.
const decodeFlightPayload = (html: string): string =>
  html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");

const sliceBalanced = (payload: string, start: number): string | undefined => {
  let depth = 0;
  for (let index = start; index < payload.length; index++) {
    const char = payload[index];
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
  return `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;
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
  const parts = [
    rank !== undefined ? `#${rank}` : "",
    series.rating ? `★ ${series.rating.toFixed(1)}` : "",
    series.viewCount ? `▲ ${formatCount(series.viewCount)}` : "",
  ].filter(Boolean);
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

export interface BrowsePage {
  series: ValirSeries[];
  hasMore: boolean;
}

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
    return [{ id: genre.slug ?? title.toLowerCase().replaceAll(" ", "-"), title }];
  });
  const tags: Tag[] = (series.tags ?? [])
    .filter((tag): tag is { name: string } => !!tag.name)
    .map((tag) => ({ id: tag.name.toLowerCase().replaceAll(" ", "-"), title: tag.name }));

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
      shareUrl: `${DOMAIN}/series/${mangaId}`,
    },
  };
};

const chapterTitle = (chapter: ValirChapterItem): string => {
  const title = chapter.title?.trim() || `Chapter ${chapter.number}`;
  return chapter.isLocked ? `🔒 ${title}` : title;
};

export const parseChapters = (
  seriesPages: ValirSeriesPage[],
  sourceManga: SourceManga,
  showPaidChapters: boolean,
): Chapter[] =>
  seriesPages
    .flatMap((page) => page.chapters ?? [])
    .filter((chapter) => showPaidChapters || !chapter.isLocked)
    .sort((a, b) => a.number - b.number)
    .map((chapter, index) => ({
      chapterId: String(chapter.number),
      sourceManga,
      langCode: "en",
      chapNum: chapter.number,
      title: chapterTitle(chapter),
      publishDate: chapter.publishedAt ? new Date(chapter.publishedAt) : undefined,
      sortingIndex: index,
    }));

// Readium renders novel chapters as XHTML, so unclosed void tags must be
// normalised into their self-closing form first.
const fixVoidElements = (html: string): string =>
  html.replace(/<(br|hr|img|input|meta|link)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/gi, "<$1$2 />");

export const parseChapterDetails = (html: string, chapter: Chapter): ChapterDetails => {
  const payload = decodeFlightPayload(html);
  const data = extractByMarker<ValirChapterData>(payload, '"chapter":').find((candidate) =>
    Array.isArray(candidate.pages),
  );
  if (!data) {
    throw new Error(`ValirScans: no chapter data found for chapter ${chapter.chapterId}`);
  }

  const pages = (data.pages ?? [])
    .slice()
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((page) => toAbsoluteUrl(page.imageUrl))
    .filter((url) => url.length > 0);
  if (pages.length > 0) {
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  if (data.content) {
    const body = fixVoidElements(data.content.replaceAll("&nbsp;", " "));
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`,
    };
  }

  throw new Error(
    `ValirScans: chapter ${chapter.chapterId} has no readable content — it may be locked`,
  );
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
      const chapter = series.chapters?.find((entry) => !entry.isLocked) ?? series.chapters?.[0];
      if (!chapter) return [];
      const date = chapter.publishedAt ?? series.lastChapterAt;
      return [
        {
          type: "chapterUpdatesCarouselItem" as const,
          mangaId: toMangaId(series),
          chapterId: String(chapter.number),
          imageUrl: toAbsoluteUrl(series.coverImage),
          title: series.title,
          subtitle: chapterTitle(chapter),
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
