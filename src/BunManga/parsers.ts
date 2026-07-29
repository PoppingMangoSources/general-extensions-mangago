/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  URL,
  type Chapter,
  type ChapterDetails,
  type ChapterUpdatesCarouselItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SimpleCarouselItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { DOMAIN, type ListingChapter, type MangaListItem } from "./models";

// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const ORIGINAL_SCRIPT_REGEX = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const ADULT_GENRES = new Set(["adult", "hentai", "smut"]);
const MATURE_GENRES = new Set(["mature", "soft yaoi", "soft yuri", "yaoi", "yuri"]);

const cleanText = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const cleanDescription = (value?: string | null): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const sanitizeId = (value: string): string => value.replace(SAFE_ID_REGEX, "-");

export const parseMangaId = (value?: string | null): string => {
  const slug = (value ?? "").match(/\/manga\/([^/?#]+)/i)?.[1] ?? "";
  return sanitizeId(slug);
};

const chapterIdFromUrl = (value?: string | null): string => {
  const path = (value ?? "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return sanitizeId(path.split("/").pop() ?? "");
};

const toAbsoluteUrl = (value?: string | null): string => {
  const url = Application.decodeHTMLEntities(value ?? "")
    .replace(/\s+/g, "")
    .trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://");
  return new URL(DOMAIN).setPath(url).toString();
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>): string => {
  const srcset = image
    .attr("srcset")
    ?.split(",")
    .map((entry) => {
      const [url, width] = entry.trim().split(/\s+/);
      return { url, width: Number.parseInt(width, 10) || 0 };
    })
    .filter((entry) => entry.url)
    .sort((left, right) => right.width - left.width)[0]?.url;
  return toAbsoluteUrl(
    image.attr("data-cfsrc") ??
      image.attr("data-src") ??
      image.attr("data-lazy-src") ??
      srcset ??
      image.attr("src"),
  );
};

export const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const parseDate = (value?: string | null): Date | undefined => {
  const text = cleanText(value);
  if (!text || /^(?:new|just now)$/i.test(text)) return undefined;

  const relative = text.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const unit = relative[2].toLowerCase();
    const date = new Date();
    if (unit === "month") date.setMonth(date.getMonth() - amount);
    else if (unit === "year") date.setFullYear(date.getFullYear() - amount);
    else {
      const milliseconds = {
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
      }[unit];
      if (milliseconds) date.setTime(date.getTime() - amount * milliseconds);
    }
    return date;
  }

  const date = new Date(text.replace(/(\d{4}-\d{2}-\d{2})\s+/, "$1T"));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const pickOriginalTitle = (value: string, primaryTitle: string): string | undefined => {
  const titles = value
    .split(/\s*[;/]\s*/)
    .map(cleanText)
    .filter((title) => title.length > 0 && title.toLowerCase() !== primaryTitle.toLowerCase());
  return titles.find((title) => ORIGINAL_SCRIPT_REGEX.test(title)) ?? titles[0];
};

const chapterNumber = (value: string): number | undefined => {
  const match = value.match(/\b(?:chapter|chap|ch\.?)[\s_-]*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]);
  return Number.isFinite(number) ? number : undefined;
};

const chapterTitle = (value: string): string | undefined => {
  const title = cleanText(value);
  const remainder = cleanText(
    title.replace(/\b(?:chapter|chap|ch\.?)[\s_-]*\d+(?:\.\d+)?/i, "").replace(/^[-:\s]+/, ""),
  );
  return remainder || undefined;
};

const parseListingChapter = (container: cheerio.Cheerio<AnyNode>): ListingChapter | undefined => {
  const link = container.find(".latest-chap .chapter a, .chapter-item .chapter a").first();
  const chapterId = chapterIdFromUrl(link.attr("href"));
  const title = cleanText(link.text());
  if (!chapterId || !title) return undefined;
  const dateContainer = container.find(".meta-item.post-on, .chapter-item").first();
  return {
    chapterId,
    title,
    publishDate: parseDate(
      dateContainer.find(".c-new-tag").first().attr("title") ?? dateContainer.text(),
    ),
  };
};

export const parseMangaList = ($: cheerio.CheerioAPI): MangaListItem[] => {
  const items: MangaListItem[] = [];
  const seen = new Set<string>();

  for (const element of $(".c-tabs-item__content").toArray()) {
    const item = $(element);
    const titleLink = item.find(".post-title a").first();
    const mangaId = parseMangaId(titleLink.attr("href"));
    const title = cleanText(titleLink.text() || titleLink.attr("title"));
    const imageUrl = imageUrlFrom(item.find(".tab-thumb img").first());
    if (!mangaId || !title || !imageUrl || seen.has(mangaId)) continue;
    seen.add(mangaId);

    const genres = item
      .find(".mg_genres .summary-content a")
      .map((_, link) => cleanText($(link).text()))
      .toArray()
      .filter(Boolean);
    const rawRating = Number.parseFloat(item.find(".meta-item.rating .score").first().text());
    const alternative = cleanText(item.find(".mg_alternative .summary-content").first().text());

    items.push({
      mangaId,
      title,
      imageUrl,
      contentRating: contentRatingForGenres(genres),
      genres,
      alternativeTitle: pickOriginalTitle(alternative, title),
      status: cleanText(item.find(".mg_status .summary-content").first().text()) || undefined,
      chapter: parseListingChapter(item),
      rating: Number.isFinite(rawRating) ? rawRating : undefined,
    });
  }

  return items;
};

export const parseTopDaily = ($: cheerio.CheerioAPI): MangaListItem[] => {
  const widget = $(".widget-manga-recent")
    .filter((_, element) =>
      /^top daily$/i.test(cleanText($(element).find(".heading").first().text())),
    )
    .first();
  return widget
    .find(".popular-item-wrap")
    .toArray()
    .flatMap((element) => {
      const item = $(element);
      const titleLink = item.find(".widget-title a").first();
      const mangaId = parseMangaId(titleLink.attr("href"));
      const title = cleanText(titleLink.text() || titleLink.attr("title"));
      const imageUrl = imageUrlFrom(item.find(".popular-img img").first());
      if (!mangaId || !title || !imageUrl) return [];
      return [
        {
          mangaId,
          title,
          imageUrl,
          contentRating: ContentRating.ADULT,
          genres: [],
          chapter: parseListingChapter(item),
        },
      ];
    });
};

export const parseLatestUpdates = ($: cheerio.CheerioAPI): MangaListItem[] =>
  $(".c-blog-listing .page-item-detail")
    .toArray()
    .flatMap((element) => {
      const item = $(element);
      const titleLink = item.find(".post-title a").first();
      const mangaId = parseMangaId(titleLink.attr("href"));
      const title = cleanText(titleLink.text() || titleLink.attr("title"));
      const imageUrl = imageUrlFrom(item.find(".item-thumb img").first());
      if (!mangaId || !title || !imageUrl) return [];
      return [
        {
          mangaId,
          title,
          imageUrl,
          contentRating: ContentRating.ADULT,
          genres: [],
          chapter: parseListingChapter(item),
        },
      ];
    });

export const parseGenreTags = ($: cheerio.CheerioAPI): Tag[] => {
  const tags: Tag[] = [];
  const seen = new Set<string>();
  for (const element of $('input[name="genre[]"]').toArray()) {
    const input = $(element);
    const id = sanitizeId(input.attr("value") ?? "");
    const title = cleanText(
      $(`label[for="${input.attr("id") ?? ""}"]`)
        .first()
        .text(),
    );
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    tags.push({ id, title });
  }
  return tags;
};

export const parseLoadMoreQueryVars = ($: cheerio.CheerioAPI): string | undefined => {
  for (const element of $("script").toArray()) {
    const match = $(element)
      .text()
      .match(/var\s+__madara_query_vars\s*=\s*(\{[^\n;]+\})\s*;/);
    if (match) return match[1];
  }
  return undefined;
};

export const parseTotalResults = ($: cheerio.CheerioAPI): number | undefined => {
  const match = cleanText($(".search-wrap .c-blog__heading h1").first().text()).match(
    /([\d,]+)\s+results?/i,
  );
  if (!match) return undefined;
  const total = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(total) ? total : undefined;
};

export const hasLoadMore = ($: cheerio.CheerioAPI): boolean => $("#navigation-ajax").length > 0;

export const toFeaturedItem = (item: MangaListItem): FeaturedCarouselItem => ({
  type: "featuredCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  supertitle: item.alternativeTitle,
  summary:
    [item.genres.slice(0, 3).join(", "), item.status]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  infoItems: item.chapter ? [{ symbol: "book.fill", text: item.chapter.title }] : undefined,
  contentRating: item.contentRating,
});

export const toSimpleItem = (item: MangaListItem): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle:
    [item.chapter?.title, item.rating != null ? `★ ${item.rating}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: item.contentRating,
});

export const toChapterUpdateItem = (
  item: MangaListItem,
): ChapterUpdatesCarouselItem | undefined => {
  if (!item.chapter) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: item.chapter.chapterId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle: item.chapter.title,
    publishDate: item.chapter.publishDate,
    contentRating: item.contentRating,
  };
};

export const toSearchResultItem = (item: MangaListItem): SearchResultItem => ({
  mangaId: item.mangaId,
  title: item.title,
  imageUrl: item.imageUrl,
  subtitle:
    [item.chapter?.title, item.status]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: item.contentRating,
});

const labeledContent = (
  $: cheerio.CheerioAPI,
  label: string,
): cheerio.Cheerio<AnyNode> | undefined => {
  for (const element of $(".post-content_item").toArray()) {
    const item = $(element);
    const heading = cleanText(item.find(".summary-heading").first().text())
      .replace(/\(s\)$/i, "")
      .toLowerCase();
    if (heading === label.toLowerCase()) return item.find(".summary-content").first();
  }
  return undefined;
};

const tagsFrom = ($: cheerio.CheerioAPI, selector: string): Tag[] => {
  const tags: Tag[] = [];
  const seen = new Set<string>();
  for (const element of $(selector).toArray()) {
    const link = $(element);
    const href = (link.attr("href") ?? "").replace(/\/+$/, "");
    const id = sanitizeId(href.split("/").pop() ?? "");
    const title = cleanText(link.text());
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    tags.push({ id, title });
  }
  return tags;
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const primaryTitle = cleanText($(".profile-manga .post-title h1").first().text());
  const thumbnailUrl = imageUrlFrom($(".summary_image img").first());
  if (!primaryTitle || !thumbnailUrl) {
    throw new Error(`Unable to parse manga details for ${mangaId}.`);
  }

  const genres = tagsFrom($, ".genres-content a");
  const tags = tagsFrom($, ".tags-content a");
  const genreTitles = genres.map((genre) => genre.title);
  const alternativeText = cleanText(labeledContent($, "Alternative")?.text());
  const secondaryTitles = alternativeText
    .split(/\s*[;/]\s*/)
    .map(cleanText)
    .filter(
      (title, index, values) =>
        title.length > 0 &&
        title.toLowerCase() !== primaryTitle.toLowerCase() &&
        values.indexOf(title) === index,
    );
  const rawRating = Number.parseFloat($("#averagerate, [itemprop=ratingValue]").first().text());
  const tagGroups: TagSection[] = [];
  if (genres.length > 0) tagGroups.push({ id: "genres", title: "Genres", tags: genres });
  if (tags.length > 0) tagGroups.push({ id: "tags", title: "Tags", tags });

  const author = cleanText(
    $(".author-content").first().text() || labeledContent($, "Author")?.text(),
  ).replace(/^updating$/i, "");
  const artist = cleanText(
    $(".artist-content").first().text() || labeledContent($, "Artist")?.text(),
  ).replace(/^updating$/i, "");

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl,
      synopsis: cleanDescription($(".description-summary .summary__content").first().text()),
      author: author || undefined,
      artist: artist || undefined,
      status: cleanText(labeledContent($, "Status")?.text()) || undefined,
      rating: Number.isFinite(rawRating) ? Math.min(1, Math.max(0, rawRating / 5)) : undefined,
      contentRating: contentRatingForGenres(genreTitles),
      tagGroups,
      shareUrl: `${DOMAIN}/manga/${mangaId}/`,
    },
  };
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const nodes = $(".wp-manga-chapter").toArray();
  const chapters = nodes.flatMap((element, index) => {
    const item = $(element);
    const link = item.find("a").first();
    const id = chapterIdFromUrl(link.attr("href"));
    const rawTitle = cleanText(link.text());
    const chapNum = chapterNumber(rawTitle || id);
    if (!id || chapNum == null) return [];
    return [
      {
        chapterId: id,
        sourceManga,
        langCode: "en",
        chapNum,
        title: chapterTitle(rawTitle),
        volume: 0,
        sortingIndex: nodes.length - index,
        publishDate: parseDate(
          item.find(".chapter-release-date .c-new-tag").first().attr("title") ??
            item.find(".chapter-release-date").text(),
        ),
      },
    ];
  });
  if (chapters.length === 0) {
    throw new Error(`No chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
  }
  return chapters;
};

export const parseChapterDetails = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const pages = $(".reading-content .page-break img")
    .toArray()
    .map((element) => imageUrlFrom($(element)))
    .filter(Boolean);
  if (pages.length === 0) {
    throw new Error(
      `No pages were found for ${chapter.sourceManga.mangaInfo.primaryTitle}, chapter ${chapter.chapNum}.`,
    );
  }
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};
