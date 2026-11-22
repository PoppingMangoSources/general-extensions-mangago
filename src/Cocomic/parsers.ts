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

const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const ORIGINAL_SCRIPT_REGEX = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const ADULT_GENRES = new Set(["18", "adult", "hentai", "smut"]);
const MATURE_GENRES = new Set(["mature", "soft yaoi", "soft yuri", "yaoi", "yaoibl", "yuri"]);
const INVALID_GENRE_LABEL =
  /(?:publication:|bato status:|bato upload status:|read direction:|tr from|[\uf000-\uf8ff]|🇨🇳|🇬🇧|🇯🇵|🇰🇷)/i;

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
  const srcset = (image.attr("data-srcset") ?? image.attr("srcset"))
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

export const contentRatingForGenres = (
  genres: string[],
  fallback = ContentRating.ADULT,
): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return genres.length > 0 ? ContentRating.EVERYONE : fallback;
};

const parseDate = (value?: string | null): Date | undefined => {
  const text = cleanText(value);
  if (!text || /^new$/i.test(text)) return undefined;
  if (/^just now$/i.test(text)) return new Date();
  if (/^today$/i.test(text)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }
  const short = /^(\d+)\s*(s|m|h|d|w|mo|y) ago$/i.exec(text);
  if (short) {
    const scale: Record<string, number> = {
      s: 1000,
      m: 60000,
      h: 3600000,
      d: 86400000,
      w: 604800000,
      mo: 2592000000,
      y: 31536000000,
    };
    return new Date(Date.now() - Number(short[1]) * scale[short[2].toLowerCase()]);
  }

  const relative = text.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const unit = relative[2].toLowerCase();
    const date = new Date();
    if (unit === "month") date.setMonth(date.getMonth() - amount);
    else if (unit === "year") date.setFullYear(date.getFullYear() - amount);
    else {
      const milliseconds = {
        second: 1_000,
        minute: 60_000,
        hour: 3_600_000,
        day: 86_400_000,
        week: 604_800_000,
      }[unit];
      if (milliseconds) date.setTime(date.getTime() - amount * milliseconds);
    }
    return date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const pickOriginalTitle = (value: string, primaryTitle: string): string | undefined => {
  const titles = value
    .split(/\s*[;/]\s*/)
    .map(cleanText)
    .filter(
      (title, index, values) =>
        title.length > 0 &&
        !/^none$/i.test(title) &&
        title.toLowerCase() !== primaryTitle.toLowerCase() &&
        values.indexOf(title) === index,
    );
  return titles.find((title) => ORIGINAL_SCRIPT_REGEX.test(title)) ?? titles[0];
};

const chapterNumber = (value: string): number | undefined => {
  const match = value.match(/\b(?:chapter|chap|ch\.?|episode|ep\.?)\s*[-_:]?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return undefined;
  const number = Number.parseFloat(match[1]);
  return Number.isFinite(number) ? number : undefined;
};

const volumeNumber = (value: string): number => {
  const match = value.match(/\bvol(?:ume)?\.?\s*[-_:]?\s*(\d+(?:\.\d+)?)/i);
  const number = match ? Number.parseFloat(match[1]) : 0;
  return Number.isFinite(number) ? number : 0;
};

const chapterTitle = (value: string): string | undefined => {
  const remainder = cleanText(
    value
      .replace(/\bvol(?:ume)?\.?\s*[-_:]?\s*\d+(?:\.\d+)?/i, "")
      .replace(/\b(?:chapter|chap|ch\.?|episode|ep\.?)\s*[-_:]?\s*\d+(?:\.\d+)?/i, "")
      .replace(/^[-:.\s]+|[-:.\s]+$/g, ""),
  );
  return remainder || undefined;
};

const parseListingChapter = (container: cheerio.Cheerio<AnyNode>): ListingChapter | undefined => {
  const link = container
    .find(".swimlane-chap, .latest-chap .chapter a, .chapter-item .chapter a")
    .first();
  const chapterId = /\/manga\/[^/]+\/[^/?#]+/.test(link.attr("href") ?? "")
    ? chapterIdFromUrl(link.attr("href"))
    : undefined;
  const title = cleanText(link.text());
  if (!title) return undefined;
  const chapterRow = link.closest(".chapter-item");
  const dateContainer =
    chapterRow.length > 0
      ? chapterRow.find(".post-on")
      : container.find(".swimlane-time, .meta-item.post-on").first();
  return {
    chapterId,
    title,
    publishDate: parseDate(
      dateContainer.find(".c-new-tag").first().attr("title") ?? dateContainer.text(),
    ),
  };
};

export const parseMangaList = (
  $: cheerio.CheerioAPI,
  elements = $(
    ".c-tabs-item__content, .page-item-detail, .related__item, .slider__item, .mobile-swimlane-card, article.asura-card",
  ).toArray(),
): MangaListItem[] => {
  const items: MangaListItem[] = [];
  const seen = new Set<string>();

  for (const element of elements) {
    const item = $(element);
    const titleLink = item
      .find(
        ".asura-card-title, .swimlane-title, .post-title a, .related__title a, .slider__content h4 a, h3 a[href*='/manga/'], h4 a[href*='/manga/']",
      )
      .first();
    const mangaId = parseMangaId(titleLink.attr("href"));
    const title = cleanText(titleLink.text() || titleLink.attr("title"));
    const imageUrl = imageUrlFrom(
      item
        .find(".item-thumb img, .tab-thumb img, .related__thumb img, .slider__thumb img, img")
        .first(),
    );
    if (!mangaId || !title || !imageUrl || seen.has(mangaId)) continue;
    seen.add(mangaId);

    const genres = item
      .find(".mg_genres .summary-content a, .genres-content a")
      .map((_, link) => cleanText($(link).text()))
      .toArray()
      .filter(Boolean);
    const rawRating = Number.parseFloat(
      item
        .find(".asura-badge-rating, .swimlane-rating, .meta-item.rating .score")
        .first()
        .text()
        .replace(/[^0-9.]/g, ""),
    );
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

export const parseTrending = ($: cheerio.CheerioAPI): MangaListItem[] => {
  const details = new Map(
    $(".hero-slide")
      .toArray()
      .map((node) => {
        const card = $(node);
        return [
          parseMangaId(card.find(".hero-actions a").attr("href")),
          cleanText(card.find(".hero-synopsis").text()),
        ];
      }),
  );
  return $(".mobile-hero-slide")
    .toArray()
    .flatMap((node) => {
      const card = $(node);
      const mangaId = parseMangaId(card.find(".mobile-hero-cta").attr("href"));
      const title = cleanText(card.find(".mobile-hero-title").text());
      const imageUrl = toAbsoluteUrl(card.attr("style")?.match(/url\(['"]?([^'")]+)['"]?\)/)?.[1]);
      if (!mangaId || !title || !imageUrl) return [];
      const genres = card
        .find(".m-genre")
        .map((_, el) => cleanText($(el).text()))
        .get();
      const rating = Number.parseFloat(
        card
          .find(".m-badge-rating")
          .text()
          .replace(/[^0-9.]/g, ""),
      );
      return [
        {
          mangaId,
          title,
          imageUrl,
          genres,
          summary: details.get(mangaId),
          contentRating: contentRatingForGenres(genres),
          ...(Number.isFinite(rating) ? { rating } : {}),
        },
      ];
    });
};

export const parseHomepageRail = ($: cheerio.CheerioAPI, title: string): MangaListItem[] => {
  const section = $(".mobile-swimlane-section")
    .filter((_, el) => cleanText($(el).find(".swimlane-heading").text()) === title)
    .first();
  return parseMangaList($, section.find(".mobile-swimlane-card").toArray());
};

export const parseGenreTags = ($: cheerio.CheerioAPI): Tag[] => {
  const tags: Tag[] = [];
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  for (const element of $('input[name="genre[]"]').toArray()) {
    const input = $(element);
    const id = sanitizeId(input.attr("value") ?? "");
    const title = cleanText(
      $(`label[for="${input.attr("id") ?? ""}"]`)
        .first()
        .text(),
    ).replace(/\s+,\s*$/, "");
    const normalizedTitle = title.toLowerCase();
    if (
      !id ||
      !title ||
      title.length > 64 ||
      INVALID_GENRE_LABEL.test(title) ||
      seenIds.has(id) ||
      seenTitles.has(normalizedTitle)
    ) {
      continue;
    }
    seenIds.add(id);
    seenTitles.add(normalizedTitle);
    tags.push({ id, title });
  }
  return tags.sort((left, right) => left.title.localeCompare(right.title));
};

export const hasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $("a.nextpostslink, a[rel='next'], .asura-pagination a.next").length > 0;

export const toFeaturedItem = (item: MangaListItem): FeaturedCarouselItem => {
  const infoItems: { symbol: string; text: string }[] = [];
  if (item.rating != null) infoItems.push({ symbol: "star.fill", text: item.rating.toString() });
  if (item.genres.length > 0) {
    infoItems.push({ symbol: "tag.fill", text: item.genres.slice(0, 2).join(", ") });
  }
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    summary: item.summary || undefined,
    infoItems:
      infoItems.length === 0
        ? undefined
        : infoItems.length === 1
          ? [infoItems[0]]
          : [infoItems[0], infoItems[1]],
    contentRating: item.contentRating,
  };
};

export const toSimpleItem = (item: MangaListItem): SimpleCarouselItem => ({
  type: "simpleCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle:
    [item.chapter?.title, item.rating != null ? `★ ${item.rating}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" | ") || undefined,
  contentRating: item.contentRating,
});

export const toChapterUpdateItem = (
  item: MangaListItem,
): ChapterUpdatesCarouselItem | undefined => {
  if (!item.chapter?.chapterId) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: item.chapter.chapterId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle: toSimpleItem(item).subtitle,
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
      .join(" | ") || undefined,
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
  const primaryTitle = cleanText(
    $(".asura-series-title, .profile-manga .post-title h1, .post-title h1, #manga-title h1")
      .first()
      .text(),
  );
  const thumbnailUrl = imageUrlFrom(
    $(".asura-poster-img, .summary_image img, .tab-summary img").first(),
  );
  if (!primaryTitle || !thumbnailUrl) {
    throw new Error(`Unable to parse manga details for ${mangaId}.`);
  }

  const genres = tagsFrom($, ".asura-genre-tag, .genres-content a");
  const tags = tagsFrom($, ".tags-content a");
  const genreTitles = genres.map((genre) => genre.title);
  const alternativeText = cleanText(
    $(".asura-series-alt-title").text() || labeledContent($, "Alternative")?.text(),
  );
  const secondaryTitles = alternativeText
    .split(/\s*[;/]\s*/)
    .map(cleanText)
    .filter(
      (title, index, values) =>
        title.length > 0 &&
        !/^none$/i.test(title) &&
        title.toLowerCase() !== primaryTitle.toLowerCase() &&
        values.indexOf(title) === index,
    );
  const rawRating = Number.parseFloat(
    $(".asura-badge-star, #averagerate, [itemprop=ratingValue], .post-total-rating .score")
      .first()
      .text()
      .replace(/[^0-9.]/g, ""),
  );
  const tagGroups: TagSection[] = [];
  if (genres.length > 0) tagGroups.push({ id: "genres", title: "Genres", tags: genres });
  if (tags.length > 0) tagGroups.push({ id: "tags", title: "Tags", tags });

  const author = cleanText(
    $(".asura-chip-author .author-name-text, .author-content").first().text() ||
      labeledContent($, "Author")?.text(),
  ).replace(/^updating$/i, "");
  const artist = cleanText(
    $(".asura-chip")
      .filter((_, el) => cleanText($(el).find(".chip-label").text()) === "Artist:")
      .find(".chip-val")
      .first()
      .text() ||
      $(".artist-content").first().text() ||
      labeledContent($, "Artist")?.text(),
  ).replace(/^updating$/i, "");

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl,
      synopsis: cleanDescription(
        $(
          ".asura-synopsis-content, .description-summary .summary__content, .description-summary, .manga-excerpt",
        )
          .first()
          .text(),
      ),
      author: author || undefined,
      artist: artist || undefined,
      status:
        cleanText($(".asura-badge-status").text() || labeledContent($, "Status")?.text()) ||
        undefined,
      rating: Number.isFinite(rawRating)
        ? Math.min(1, Math.max(0, rawRating / ($(".asura-series-title").length ? 10 : 5)))
        : undefined,
      contentRating: contentRatingForGenres(genreTitles),
      tagGroups,
      shareUrl: `${DOMAIN}/manga/${mangaId}/`,
    },
  };
};

export const parseChapters = ($: cheerio.CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const nodes = $("li.wp-manga-chapter").toArray();
  const seen = new Set<string>();
  const chapters = nodes.flatMap((element, index) => {
    const item = $(element);
    const link = item.find("a").first();
    const id = chapterIdFromUrl(link.attr("href"));
    const rawTitle = cleanText(link.text());
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        chapterId: item.hasClass("premium") ? `${id}#lock` : id,
        sourceManga,
        langCode: "en",
        chapNum: chapterNumber(rawTitle || id) ?? 0,
        title: chapterTitle(rawTitle),
        volume: volumeNumber(rawTitle),
        sortingIndex: nodes.length - index,
        publishDate: parseDate(
          item.find(".chapter-release-date .c-new-tag").first().attr("title") ??
            item.find(".chapter-release-date").text(),
        ),
      },
    ];
  });
  if (chapters.length === 0) {
    throw new Error(`No readable chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
  }
  return chapters;
};

export const parseChapterDetails = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const pages = $(
    ".asura-stream-images img, .reading-content .page-break img, .reading-content img.wp-manga-chapter-img",
  )
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
