/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  URL,
  type Chapter,
  type ChapterDetails,
  type ChapterUpdatesCarouselItem,
  type DiscoverSectionItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  type ChapterPageInfo,
  type ListingChapter,
  type MangaListItem,
  type NewMangaItem,
} from "./models";

const ADULT_GENRES = new Set(["adult", "hentai", "smut"]);
const MATURE_GENRES = new Set(["ecchi", "mature", "yaoi", "yuri"]);
const KOREAN_TITLE_REGEX =
  /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af][\u1100-\u11ff\u3130-\u318f\uac00-\ud7af0-9\s·-]*/g;

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

const normalizedPath = (href: string): string => {
  const path = Application.decodeHTMLEntities(href)
    .replace(/^https?:\/\/(?:www\.)?likemanga\.ink\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

export const encodePathId = (href: string): string =>
  encodeURIComponent(normalizedPath(href)).replace(
    /[!'*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const toAbsoluteUrl = (value?: string | null): string => {
  const url = (value ?? "").trim();
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(DOMAIN).setPath(url).toString();
};

const imageUrlFrom = (image: cheerio.Cheerio<AnyNode>): string => {
  const srcset = image.attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
  return toAbsoluteUrl(
    image.attr("data-cfsrc") ??
      image.attr("data-src") ??
      image.attr("data-lazy-src") ??
      srcset ??
      image.attr("src"),
  );
};

const koreanTitleFrom = (value?: string | null): string | undefined =>
  (cleanText(value).match(KOREAN_TITLE_REGEX) ?? [])
    .map(cleanText)
    .sort((left, right) => right.length - left.length)[0];

const labeledValue = (
  $: cheerio.CheerioAPI,
  container: cheerio.Cheerio<AnyNode>,
  label: string,
): string => {
  for (const paragraph of container.find("p").toArray()) {
    const selection = $(paragraph);
    const currentLabel = cleanText(selection.find("label").first().text())
      .replace(/:$/, "")
      .toLowerCase();
    if (currentLabel !== label.toLowerCase()) continue;
    const clone = selection.clone();
    clone.find("label").remove();
    return cleanText(clone.text());
  }
  return "";
};

const parseDate = (value?: string | null): Date | undefined => {
  const text = cleanText(value);
  if (!text || /^new$/i.test(text)) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const contentRatingForGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.trim().toLowerCase());
  if (normalized.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;
  if (normalized.some((genre) => MATURE_GENRES.has(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const chapterNumber = (title: string): number | undefined => {
  const match = title.match(/\b(?:chapter|ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : undefined;
};

const formatChapterTitle = (title: string): string => {
  const text = cleanText(title);
  const match = text.match(/\b(?:chapter|ch\.?)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return text;
  let rest = cleanText(text.slice((match.index ?? 0) + match[0].length).replace(/^[-:\s•]+/, ""));
  const duplicate = rest.match(
    new RegExp(`^[-:\\s•]*(?:chapter|ch\\.?)\\s*${match[1].replace(".", "\\.")}\\b`, "i"),
  );
  if (duplicate)
    rest = cleanText(
      rest.slice((duplicate.index ?? 0) + duplicate[0].length).replace(/^[-:\s•]+/, ""),
    );
  return rest;
};

const formatChapterLabel = (title: string): string => {
  const cleanedTitle = formatChapterTitle(title);
  if (cleanedTitle) return cleanedTitle;
  return (
    cleanText(title).match(/\b(?:chapter|ch\.?)\s*[0-9]+(?:\.[0-9]+)?/i)?.[0] ?? cleanText(title)
  );
};

const chapterTitleFromLink = (link: cheerio.Cheerio<AnyNode>): string => {
  const nestedTitle = cleanText(
    link.find(".chapter-item-title, .chapter-item-headtitle, .chapter-title").first().text(),
  );
  if (nestedTitle) return nestedTitle;
  const clone = link.clone();
  clone.find("cite, time, .chapter-release-date, .text-danger, script, style").remove();
  return cleanText(clone.text());
};

const parseListingChapter = (
  $: cheerio.CheerioAPI,
  element: AnyNode,
): ListingChapter | undefined => {
  const row = $(element);
  const link = row.find("a.list-2-chap, a").first();
  const href = link.attr("href") ?? "";
  const title = chapterTitleFromLink(link);
  if (!href || !title) return undefined;
  const dateNode = row.find("cite").first();
  return {
    chapterId: encodePathId(href),
    title,
    dateText: cleanText(dateNode.text()),
    isNew: dateNode.find(".text-danger").length > 0 || /^new$/i.test(dateNode.text().trim()),
  };
};

export const parseMangaList = ($: cheerio.CheerioAPI): MangaListItem[] => {
  const items: MangaListItem[] = [];
  const seen = new Set<string>();

  for (const element of $(".video").toArray()) {
    const card = $(element);
    const titleLink = card.find("p.title-manga a").first();
    const href = titleLink.attr("href") ?? card.find("a").first().attr("href") ?? "";
    const mangaId = encodePathId(href);
    const title = cleanText(titleLink.text() || card.find("img").first().attr("alt"));
    if (!mangaId || !title || seen.has(mangaId)) continue;
    seen.add(mangaId);

    const tooltipSelector = card.find("img[data-jtip]").first().attr("data-jtip");
    const tooltip = tooltipSelector ? $(tooltipSelector) : card.find("[data-missing-tooltip]");
    const genreText = labeledValue($, tooltip, "Genres");
    const genres = genreText
      .split(",")
      .map(cleanText)
      .filter((genre) => genre.length > 0);
    const rawRating = Number.parseFloat(tooltip.find("[itemprop=ratingValue]").first().text());

    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(card.find("img").first()),
      alternativeTitle: koreanTitleFrom(labeledValue($, tooltip, "Alternative")),
      description: cleanDescription(tooltip.find(".box_text").first().text()) || undefined,
      genres,
      status: labeledValue($, tooltip, "Status") || undefined,
      views: labeledValue($, tooltip, "View") || undefined,
      comments: labeledValue($, tooltip, "Comment") || undefined,
      follows: labeledValue($, tooltip, "Follow") || undefined,
      rating: Number.isFinite(rawRating) ? rawRating : undefined,
      updatedDate: parseDate(labeledValue($, tooltip, "Updated")),
      chapters: card
        .find(".list-group-item")
        .toArray()
        .flatMap((chapter) => {
          const parsed = parseListingChapter($, chapter);
          return parsed ? [parsed] : [];
        }),
    });
  }

  return items;
};

export const parseNewManga = ($: cheerio.CheerioAPI): NewMangaItem[] => {
  const items: NewMangaItem[] = [];
  const seen = new Set<string>();
  for (const element of $(".items-slide .item").toArray()) {
    const item = $(element);
    const titleLink = item.find(".slide-caption h3 a").first();
    const href = titleLink.attr("href") ?? "";
    const mangaId = encodePathId(href);
    const title = cleanText(titleLink.text());
    if (!mangaId || !title || seen.has(mangaId)) continue;
    seen.add(mangaId);
    const chapterLink = item.find(".slide-caption > a").first();
    const chapterHref = chapterLink.attr("href") ?? "";
    const chapterTitle = chapterTitleFromLink(chapterLink);
    items.push({
      mangaId,
      title,
      imageUrl: imageUrlFrom(item.find("img").first()),
      chapter:
        chapterHref && chapterTitle
          ? {
              chapterId: encodePathId(chapterHref),
              title: chapterTitle,
              dateText: cleanText(item.find(".time").text()),
              isNew: item.find(".time .text-danger").length > 0,
            }
          : undefined,
    });
  }
  return items;
};

export const parseGenreTags = ($: cheerio.CheerioAPI): Tag[] => {
  const tags: Tag[] = [];
  const seen = new Set<string>();
  const inputs = $('input[name="f[genres][]"]');
  if (inputs.length > 0) {
    for (const element of inputs.toArray()) {
      const input = $(element);
      const id = encodePathId(input.attr("value") ?? "");
      const title = cleanText(
        $(`label[for="${input.attr("id") ?? ""}"]`)
          .first()
          .text(),
      );
      if (!id || !title || /^genres$/i.test(title) || seen.has(id)) continue;
      seen.add(id);
      tags.push({ id, title });
    }
    return tags;
  }

  for (const element of $('a[href*="/genres/"]').toArray()) {
    const link = $(element);
    const href = link.attr("href")?.replace(/\/+$/, "") ?? "";
    const id = encodePathId(href.split("/").pop() ?? "");
    const title = cleanText(link.text());
    if (!id || !title || /^genres$/i.test(title) || seen.has(id)) continue;
    seen.add(id);
    tags.push({ id, title });
  }
  return tags;
};

const mapStatus = (status: string): string | undefined => {
  const normalized = cleanText(status).toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("complete")) return "Completed";
  if (normalized.includes("in process") || normalized.includes("ongoing")) return "Ongoing";
  if (normalized.includes("pause") || normalized.includes("hiatus")) return "Hiatus";
  return cleanText(status);
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const primaryTitle = cleanText($("#title-detail-manga").first().text());
  if (!primaryTitle) throw new Error(`Unable to parse manga details for ${mangaId}.`);

  const koreanTitle = koreanTitleFrom($(".list-info .othername p").eq(1).text());
  const genres = $(".list-info .kind a")
    .map((_, element) => cleanText($(element).text()))
    .toArray()
    .filter((genre) => genre.length > 0);
  const tags = $(".list-info .kind a")
    .map((_, element) => {
      const link = $(element);
      const href = link.attr("href")?.replace(/\/+$/, "") ?? "";
      return { id: href.split("/").pop() ?? "", title: cleanText(link.text()) };
    })
    .toArray()
    .filter((tag) => tag.id.length > 0 && tag.title.length > 0);
  const rawRating = Number.parseFloat($("[itemprop=ratingValue]").first().text());
  const author = cleanText($(".list-info .author p").eq(1).text());

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles:
        koreanTitle && koreanTitle.toLowerCase() !== primaryTitle.toLowerCase()
          ? [koreanTitle]
          : [],
      thumbnailUrl: imageUrlFrom($(".detail-info img").first()),
      synopsis: cleanDescription($("#summary_shortened").first().text()),
      author: author && !/^updating$/i.test(author) ? author : undefined,
      status: mapStatus($(".list-info .status p").eq(1).text()),
      rating: Number.isFinite(rawRating) ? Math.min(1, Math.max(0, rawRating / 5)) : undefined,
      contentRating: contentRatingForGenres(genres),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: new URL(DOMAIN).setPath(normalizedPath(mangaId)).toString(),
    },
  };
};

export const parseChapterPageInfo = ($: cheerio.CheerioAPI): ChapterPageInfo => {
  let lastPage = 1;
  for (const element of $(".chapters_pagination a").toArray()) {
    const match = ($(element).attr("onclick") ?? "").match(/load_list_chapter\((\d+)\)/);
    if (match) lastPage = Math.max(lastPage, Number.parseInt(match[1], 10));
  }
  return {
    mangaNumericId: $("#title-detail-manga").attr("data-manga") || undefined,
    lastPage,
  };
};

export const parseChapters = (
  $: cheerio.CheerioAPI,
  fragments: string[],
  sourceManga: SourceManga,
): Chapter[] => {
  const roots = [$, ...fragments.map((fragment) => cheerio.load(fragment))];
  const entries: { chapterId: string; name: string; dateText: string }[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    for (const element of root(".wp-manga-chapter").toArray()) {
      const row = root(element);
      const link = row.find("a").first();
      const href = link.attr("href") ?? "";
      const chapterId = encodePathId(href);
      const name = chapterTitleFromLink(link);
      if (!chapterId || !name || seen.has(chapterId)) continue;
      seen.add(chapterId);
      entries.push({
        chapterId,
        name,
        dateText: cleanText(row.find(".chapter-release-date").text()),
      });
    }
  }
  if (entries.length === 0) throw new Error(`No chapters found for ${sourceManga.mangaId}.`);

  const fallbackDate = parseDate($("article > time, #item-detail > time").first().text());
  return entries.map((entry, index) => {
    const number = chapterNumber(entry.name);
    const title = formatChapterTitle(entry.name);
    return {
      chapterId: entry.chapterId,
      sourceManga,
      langCode: "en",
      chapNum: number ?? 0,
      title: title || undefined,
      volume: 0,
      sortingIndex: entries.length - index,
      publishDate:
        parseDate(entry.dateText) ?? (/^new$/i.test(entry.dateText) ? fallbackDate : undefined),
    };
  });
};

const base64ToString = (value: string): string => {
  const decoded = Application.base64Decode(value);
  return typeof decoded === "string" ? decoded : Application.arrayBufferToUTF8String(decoded);
};

export const parseChapterPages = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const pages: string[] = [];
  const tokenValue = $("#next_img_token").attr("value") ?? "";
  const cdnUrl = $("#currentlink").attr("value")?.replace(/\/+$/, "") ?? "";
  const encodedPayload = tokenValue.split(".")[1];

  if (encodedPayload && cdnUrl) {
    try {
      const payload = JSON.parse(base64ToString(encodedPayload)) as { data?: unknown };
      if (typeof payload.data === "string") {
        const manifest = JSON.parse(base64ToString(payload.data)) as unknown;
        if (Array.isArray(manifest)) {
          for (const image of manifest) {
            if (typeof image === "string" && image.length > 0) pages.push(`${cdnUrl}/${image}`);
          }
        }
      }
    } catch {
      pages.length = 0;
    }
  }

  if (pages.length === 0) {
    const seen = new Set<string>();
    for (const element of $(".reading-detail.box_doc img").toArray()) {
      const imageUrl = imageUrlFrom($(element));
      if (!imageUrl || seen.has(imageUrl)) continue;
      seen.add(imageUrl);
      pages.push(imageUrl);
    }
  }
  if (pages.length === 0) throw new Error(`No readable pages found for ${chapter.chapterId}.`);

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};

export const hasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $(".pagination a")
    .toArray()
    .some((element) => cleanText($(element).text()) === "»");

export const toFeaturedItem = (item: MangaListItem): FeaturedCarouselItem => {
  const infoItems: NonNullable<FeaturedCarouselItem["infoItems"]>[number][] = [];
  const chapters = item.chapters
    .slice(0, 2)
    .map((chapter) => {
      const number = chapterNumber(chapter.title);
      return number == null ? formatChapterLabel(chapter.title) : `CH. ${number}`;
    })
    .join(" • ");
  if (chapters) infoItems.push({ symbol: "book.closed.fill", text: chapters });
  infoItems.push({ symbol: "heart.fill", text: item.follows || "0" });

  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: item.alternativeTitle,
    summary: item.description,
    infoItems: infoItems.length
      ? (infoItems.slice(0, 2) as FeaturedCarouselItem["infoItems"])
      : undefined,
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toNewMangaItem = (item: NewMangaItem): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle: [item.chapter ? formatChapterLabel(item.chapter.title) : undefined, "NEW"]
    .filter(Boolean)
    .join(" • "),
  contentRating: ContentRating.EVERYONE,
});

export const toLatestReleaseItem = (
  item: MangaListItem,
): ChapterUpdatesCarouselItem | undefined => {
  const chapter = item.chapters[0];
  if (!chapter) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: chapter.chapterId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle: formatChapterLabel(chapter.title),
    publishDate: parseDate(chapter.dateText) ?? (chapter.isNew ? item.updatedDate : undefined),
    contentRating: contentRatingForGenres(item.genres),
  };
};

export const toHotItem = (item: MangaListItem): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle: [
    item.chapters[0] ? formatChapterLabel(item.chapters[0].title) : undefined,
    item.views ? `${item.views} views` : "",
  ]
    .filter(Boolean)
    .join(" • "),
  contentRating: contentRatingForGenres(item.genres),
});

export const toSearchResultItem = (item: MangaListItem, rank?: number): SearchResultItem => ({
  mangaId: item.mangaId,
  imageUrl: item.imageUrl,
  title: item.title,
  subtitle: [
    rank != null ? `#${rank}` : "",
    item.views ? `${item.views} views` : "",
    item.chapters[0] ? formatChapterLabel(item.chapters[0].title) : undefined,
  ]
    .filter(Boolean)
    .join(" • "),
  contentRating: contentRatingForGenres(item.genres),
});
