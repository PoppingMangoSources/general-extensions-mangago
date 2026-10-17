/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  DOMAIN,
  PAID_CHAPTER_SUFFIX,
  TRENDING_RANGES,
  type BrowseSeries,
  type ComicSeriesLd,
  type FeaturedEntry,
  type SearchMetadata,
  type SiteChapter,
  type TrendingEntry,
  type TrendingRange,
  type TrendingResponse,
} from "./models";

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

// The details page renders its data, so it is read from the page as served: the schema.org block,
// the synopsis, and the catalog entry, the only place the status lives.
export const parseMangaDetails = (
  html: string,
  mangaId: string,
  entry: BrowseSeries | undefined,
): SourceManga => {
  const $ = cheerio.load(html);
  const series = $('script[type="application/ld+json"]')
    .toArray()
    .flatMap((element): ComicSeriesLd[] => {
      try {
        const value = JSON.parse($(element).text()) as ComicSeriesLd;
        return value?.["@type"] === "ComicSeries" ? [value] : [];
      } catch {
        // Another block that is not JSON; the series block is searched for.
        return [];
      }
    })[0];
  const synopsisElement = $("#series-synopsis-text");
  const paragraphs = synopsisElement
    .find("p")
    .toArray()
    .map((element) => $(element).text().trim());
  const synopsis = paragraphs.length ? paragraphs.join("\n\n") : synopsisElement.text().trim();

  const genres = series?.genre ?? [];
  const adult = genres.some((genre) => genre.toLowerCase() === "+18");
  const tagTitles = [
    entry?.badge ?? "",
    adult ? "Adult" : "",
    ...genres.filter((genre) => genre.toLowerCase() !== "+18"),
  ].filter(Boolean);
  const seen = new Set<string>();
  const tags: Tag[] = tagTitles.flatMap((title) => {
    const id = sanitizeId(title);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ id, title }];
  });
  const alternateName = series?.alternateName || entry?.alternative_names;

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(series?.name || entry?.title || mangaId),
      secondaryTitles: alternateName ? [Application.decodeHTMLEntities(alternateName)] : [],
      thumbnailUrl: series?.image || entry?.thumbnail || "",
      synopsis: cleanDescription(synopsis || series?.description || ""),
      author: series?.author?.name ? Application.decodeHTMLEntities(series.author.name) : undefined,
      status: statusLabel(entry?.status),
      contentRating: ContentRating.ADULT,
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      shareUrl: `${DOMAIN}/comic/${mangaId}`,
    },
  };
};

const chapterNumber = (chapter: SiteChapter): number => {
  const match = (chapter.name ?? "").match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

const chapterTitle = (chapter: SiteChapter): string => {
  const title = (
    chapter.title?.trim() ||
    (chapter.name ?? "").replace(/^chapter\s+\d+(?:\.\d+)?(?:\s*[-:]\s*)?/i, "").trim()
  ).trim();
  return chapter.premium ? (title ? `${title} (LOCKED)` : "(LOCKED)") : title;
};

export const parseChapters = (
  chapters: SiteChapter[],
  sourceManga: SourceManga,
  showPaidChapters: boolean,
): Chapter[] =>
  chapters
    .filter((chapter) => chapter.slug && (showPaidChapters || !chapter.premium))
    .map((chapter) => ({
      chapterId: `${chapter.slug}${chapter.premium ? PAID_CHAPTER_SUFFIX : ""}`,
      sourceManga,
      langCode: "en",
      chapNum: chapterNumber(chapter),
      title: chapterTitle(chapter),
      volume: 0,
      publishDate: chapter.createdAt ? new Date(chapter.createdAt) : undefined,
    }));

const time = (value: string | null | undefined): number => {
  const parsed = new Date(value ?? "").getTime();
  return isNaN(parsed) ? 0 : parsed;
};

export const sortSeries = (series: BrowseSeries[], sort: string | undefined): BrowseSeries[] =>
  [...series].sort((a, b) => {
    switch (sort) {
      case "updated":
        return time(b.update_chapter) - time(a.update_chapter);
      case "created":
        return time(b.created_at) - time(a.created_at);
      default:
        return (b.total_views ?? 0) - (a.total_views ?? 0);
    }
  });

export const toCarouselItem = (series: BrowseSeries): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: series.series_slug,
  title: series.title,
  imageUrl: series.thumbnail ?? "",
  subtitle: series.badge ?? undefined,
  contentRating: ContentRating.ADULT,
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
