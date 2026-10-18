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
  type SearchMetadata,
  type SiteChapter,
  type TrendingRange,
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

// The site renames some fields with every update; a homepage entry's title and slug are found by
// their values among the fields it leaves alone.
const UNRENAMED_FIELDS = new Set([
  "id",
  "description",
  "thumbnail",
  "badge",
  "protagonist",
  "banner",
  "total_views",
  "day_views",
  "week_views",
  "month_views",
]);
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const toHomeEntries = (
  value: unknown,
): { slug: string; title: string; fields: Record<string, unknown> }[] =>
  (Array.isArray(value) ? value : []).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object") return [];
    const fields = entry as Record<string, unknown>;
    const strings = Object.entries(fields).flatMap(([key, field]) =>
      !UNRENAMED_FIELDS.has(key) && typeof field === "string" && field.trim() ? [field.trim()] : [],
    );
    const slug =
      typeof fields.series_slug === "string"
        ? fields.series_slug
        : strings.find((field) => SLUG_REGEX.test(field));
    const title =
      typeof fields.title === "string"
        ? fields.title
        : strings.find((field) => field !== slug && !/^https?:\/\//i.test(field));
    return slug && title ? [{ slug, title: Application.decodeHTMLEntities(title), fields }] : [];
  });

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

// The hero carousel shows each series' cut-out character art, as the site's does.
export const toFeaturedItems = (value: unknown): DiscoverSectionItem[] =>
  toHomeEntries(value).map(({ slug, title, fields }) => {
    const views = typeof fields.total_views === "number" ? fields.total_views : 0;
    return {
      type: "featuredCarouselItem",
      mangaId: slug,
      title,
      imageUrl: text(fields.protagonist) ?? text(fields.banner) ?? text(fields.thumbnail) ?? "",
      summary: cleanDescription(text(fields.description) ?? "") || undefined,
      infoItems: views ? [{ symbol: "eye.fill", text: formatCount(views) }] : undefined,
      contentRating: ContentRating.ADULT,
    };
  });

// The homepage's Latest updates cards list each series' newest chapters, newest first. A card opens
// its newest free chapter, and a series with only paid chapters there is left out.
export const parseLatestUpdates = (html: string): DiscoverSectionItem[] => {
  const $ = cheerio.load(html);
  const section = $("section")
    .filter((_, element) => /latest updates/i.test($(element).find("h2").first().text()))
    .first();
  return section
    .find('h3 a[href^="/comic/"]')
    .toArray()
    .flatMap((link): DiscoverSectionItem[] => {
      const card = $(link).closest("article");
      const mangaId = ($(link).attr("href") ?? "").split("/")[2];
      const row = card
        .find('li a[href^="/comic/"]')
        .toArray()
        .find(
          (element) =>
            !$(element)
              .find(".sr-only")
              .toArray()
              .some((marker) => $(marker).text().trim().toLowerCase() === "premium"),
        );
      const chapterId = row ? ($(row).attr("href") ?? "").split("/")[3] : undefined;
      if (!mangaId || !row || !chapterId) return [];
      const label = $(row).find(".truncate").clone();
      label.find(".sr-only").remove();
      const date = new Date($(row).find("time").attr("datetime") ?? "");
      return [
        {
          type: "chapterUpdatesCarouselItem",
          mangaId,
          chapterId,
          title: Application.decodeHTMLEntities($(link).text().trim()),
          subtitle: Application.decodeHTMLEntities(label.text().trim()) || undefined,
          imageUrl: card.find("img").first().attr("src") ?? "",
          publishDate: isNaN(date.getTime()) ? undefined : date,
          contentRating: ContentRating.ADULT,
        },
      ];
    });
};

export const toTrendingSections = (): DiscoverSectionItem[] =>
  TRENDING_RANGES.map((range) => ({
    type: "genresCarouselItem",
    name: range.title,
    searchQuery: { title: "", metadata: { trending: range.id } satisfies SearchMetadata },
  }));

export const toTrendingItems = (value: unknown, range: TrendingRange): SearchResultItem[] => {
  const list = TRENDING_RANGES.find(({ id }) => id === range)?.list ?? "";
  const lists = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return toHomeEntries(lists[list]).map(({ slug, title, fields }, index) => {
    const views = fields[`${range}_views`];
    return {
      mangaId: slug,
      title,
      imageUrl: text(fields.thumbnail) ?? "",
      subtitle: [`#${index + 1}`, typeof views === "number" ? `${formatCount(views)} views` : ""]
        .filter(Boolean)
        .join(" • "),
      contentRating: ContentRating.ADULT,
    };
  });
};

export const toSearchResultItem = (series: BrowseSeries): SearchResultItem => ({
  mangaId: series.series_slug,
  title: series.title,
  imageUrl: series.thumbnail ?? "",
  subtitle: series.total_views ? `${formatCount(series.total_views)} views` : undefined,
  contentRating: ContentRating.ADULT,
});
