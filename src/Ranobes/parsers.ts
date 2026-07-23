/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SortingOption,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  GENRES,
  SORT_ORDERS,
  VOID_TAGS,
  type FilterTaxonomy,
  type ListingType,
  type RanobesChapterPage,
  type RanobesListing,
  type SearchMetadata,
} from "./models";

const absoluteUrl = (value: string): string => {
  const url = value.trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value.replace(/\s+/g, " ").trim());

const parseCount = (value: string): number | undefined => {
  const digits = value.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : undefined;
};

const parseImageUrl = (element: cheerio.Cheerio<AnyNode>): string => {
  const source = [
    element.attr("src"),
    element.attr("data-src"),
    element.attr("data-original"),
    element.attr("data-lazy-src"),
  ].find((value) => value?.trim() && !value.includes("data:image"));
  if (source) return absoluteUrl(source);

  const background = element.attr("style")?.match(/url\(['"]?([^)'"\s]+)['"]?\)/i)?.[1];
  return background ? absoluteUrl(background) : "";
};

const parseRating = (card: cheerio.Cheerio<AnyNode>): { rating?: number; ratingCount?: number } => {
  const rating = Number(
    card.find(".r-date .rate-drop strong, .rank-story-data-val").first().text(),
  );
  return {
    rating: Number.isFinite(rating) ? rating : undefined,
    ratingCount: parseCount(
      card.find("[id^='vote-num-id-'], .rank-story-data-info").first().text(),
    ),
  };
};

const parseViews = (card: cheerio.Cheerio<AnyNode>): number | undefined => {
  const title = card.find(".meta_author").attr("title") ?? "";
  const views = title.match(/views:\s*([\d\s]+)/i)?.[1];
  if (views) return parseCount(views);

  const stats = card.find(".rank-story-data").first();
  return stats.find(".fa-eye").length
    ? parseCount(stats.find(".rank-story-data-val").first().text())
    : undefined;
};

const parseGenres = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
  selector: string,
): string[] =>
  card
    .find(selector)
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);

const parseRelativeDate = (value: string): Date | undefined => {
  const text = value.toLowerCase().trim();
  if (!text) return undefined;
  if (text.includes("less than a minute") || text === "just now") return new Date();

  const count = Number(text.match(/\d+/)?.[0] ?? 0);
  const unit = text.includes("minute")
    ? 60_000
    : text.includes("hour")
      ? 3_600_000
      : text.includes("day")
        ? 86_400_000
        : text.includes("week")
          ? 604_800_000
          : text.includes("month")
            ? 2_629_800_000
            : text.includes("year")
              ? 31_557_600_000
              : undefined;
  if (unit) return new Date(Date.now() - count * unit);

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const novelUrlFromChapter = (href: string): string => {
  const url = absoluteUrl(href);
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  const match = path.match(/^\/([^/]+)-(\d+)\/\d+\.html$/i);
  if (!match) return url;
  return `${DOMAIN}/novels/${match[2]}-${match[1].replace(/-\d+$/, "")}.html`;
};

export const extractNovelId = (mangaId: string): string => {
  const match = mangaId.match(/\/novels\/(\d+)-/i);
  if (!match) throw new Error(`Ranobes: could not identify novel ${mangaId}`);
  return match[1];
};

export const toFilterOptionId = (title: string): string =>
  `filter_${Array.from(title)
    .map((character) => character.codePointAt(0)?.toString(36))
    .join("_")}`;

const titleFromFilterOptionId = (id: string): string => {
  if (!id.startsWith("filter_")) return id;
  const codePoints = id
    .slice(7)
    .split("_")
    .map((value) => Number.parseInt(value, 36));
  return codePoints.every(Number.isFinite) ? String.fromCodePoint(...codePoints) : id;
};

export const parseFilterTaxonomy = ($: cheerio.CheerioAPI): FilterTaxonomy => {
  const events = $(".cat_block a[href*='/tags/events/'] h3")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  return {
    genres: GENRES.map((title) => ({ id: toFilterOptionId(title), title })),
    events: [...new Set(events)].map((title) => ({ id: toFilterOptionId(title), title })),
  };
};

export const buildSearchPath = (
  title: string,
  metadata: SearchMetadata | undefined,
  sortingOption: SortingOption | undefined,
): string | undefined => {
  const segments: string[] = [];
  const add = (key: string, value: string | undefined) => {
    if (value) segments.push(`${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`);
  };
  const selected = (
    values: Record<string, "included" | "excluded"> | undefined,
    state: "included" | "excluded",
  ): string =>
    Object.entries(values ?? {})
      .filter(([, value]) => value === state)
      .map(([id]) => titleFromFilterOptionId(id))
      .join(",");

  add("l.title", title.trim());
  add("n.genre", selected(metadata?.genres, "included"));
  add("v.genre", selected(metadata?.genres, "excluded"));
  add("n.events", selected(metadata?.events, "included"));
  add("v.events", selected(metadata?.events, "excluded"));
  add("b.languages", selected(metadata?.languages, "included"));
  add("v.languages", selected(metadata?.languages, "excluded"));
  add("f.year", metadata?.yearFrom);
  add("t.year", metadata?.yearTo);
  add("status-trs", metadata?.translationStatus);
  add("status-end", metadata?.originalStatus);
  add("f.chap-num", metadata?.chaptersFrom);
  add("t.chap-num", metadata?.chaptersTo);
  add("f.pvotenum", metadata?.ratingsFrom);
  add("t.pvotenum", metadata?.ratingsTo);
  add("n.authors", metadata?.authors);
  add("v.authors", metadata?.excludedAuthors);
  add("n.translater", metadata?.translators);
  add("v.translater", metadata?.excludedTranslators);
  add("n.l.tags", metadata?.publishers);
  add("!m.tags", metadata?.excludedPublishers);
  if (metadata?.onlyTranslated) add("g.translater", "1");
  if (metadata?.mtlFiles || metadata?.mtlReader) add("g.mtl_files", "1");
  if (metadata?.aiTranslated) {
    add("b.mtl-ai-translator", "DeepSeek,LLaMA 4,Gemini Flash,Mistral");
  }

  const sorting = SORT_ORDERS.find(({ id }) => id === sortingOption?.id);
  add("sort", sorting && "sort" in sorting ? sorting.sort : undefined);
  add("order", sorting && "order" in sorting ? sorting.order : undefined);
  return segments.length ? `/f/${segments.join("/")}/` : undefined;
};

export const parseContentRating = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (["adult", "hentai", "smut", "yaoi"].some((genre) => normalized.includes(genre))) {
    return ContentRating.ADULT;
  }
  if (["ecchi", "mature"].some((genre) => normalized.includes(genre))) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

const parseStory = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): RanobesListing | undefined => {
  const link = card.find("h2.title a").first();
  const mangaId = absoluteUrl(link.attr("href") ?? "");
  const title = cleanText(link.text());
  const imageUrl = parseImageUrl(card.find("figure.cover").first());
  if (!mangaId || !title || !imageUrl) return undefined;

  return {
    mangaId,
    title,
    imageUrl,
    description: cleanText(
      card.find(".cont-in > div[style*='color'], .moreless__short").first().text(),
    ),
    ...parseRating(card),
    views: parseViews(card),
    genres: parseGenres($, card, ".r-rate .grey a, .rank-story-genre a"),
  };
};

const parseRanking = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): RanobesListing | undefined => {
  const link = card.find("h2.title a").first();
  const mangaId = absoluteUrl(link.attr("href") ?? "");
  const title = cleanText(link.text());
  const imageUrl = parseImageUrl(card.find("figure.fit-cover img").first());
  if (!mangaId || !title || !imageUrl) return undefined;

  return {
    mangaId,
    title,
    imageUrl,
    description: cleanText(card.find(".moreless__short").first().text()),
    ...parseRating(card),
    views: parseViews(card),
    genres: parseGenres($, card, ".rank-story-genre a"),
  };
};

const parseUpdate = (card: cheerio.Cheerio<AnyNode>): RanobesListing | undefined => {
  const link = card.find("a").first();
  const chapterId = absoluteUrl(link.attr("href") ?? "");
  const title = cleanText(card.find("h3.title").text());
  const imageUrl = parseImageUrl(card.find("i.image.cover").first());
  if (!chapterId || !title || !imageUrl) return undefined;

  return {
    mangaId: novelUrlFromChapter(chapterId),
    chapterId,
    chapterTitle: cleanText(card.find(".subtitle").text()),
    title,
    imageUrl,
    publishDate: parseRelativeDate(card.find("em").text()),
  };
};

export const parseListings = (
  $: cheerio.CheerioAPI,
  type: ListingType = "all",
): RanobesListing[] => {
  if (type === "updates") {
    return $("div.block.story_line.story_line-img")
      .toArray()
      .flatMap((element) => {
        const listing = parseUpdate($(element));
        return listing ? [listing] : [];
      });
  }

  const stories =
    type === "rankings"
      ? []
      : $("article.block.story.shortstory")
          .toArray()
          .flatMap((element) => {
            const listing = parseStory($, $(element));
            return listing ? [listing] : [];
          });
  const rankings =
    type === "stories"
      ? []
      : $("article.rank-story")
          .toArray()
          .flatMap((element) => {
            const listing = parseRanking($, $(element));
            return listing ? [listing] : [];
          });
  return [...stories, ...rankings];
};

export const isLastListingPage = ($: cheerio.CheerioAPI): boolean =>
  $(".navigation .page_next a").length === 0;

const parseSynopsis = ($: cheerio.CheerioAPI): string => {
  const html = $(".r-desription .cont-text").first().html() ?? "";
  return cleanText(
    html
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\n\s+/g, "\n"),
  );
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const title = cleanText(
    $("h1.title")
      .first()
      .contents()
      .filter((_, node) => node.type === "text")
      .text(),
  );
  if (!title) throw new Error(`Ranobes: no novel title found for ${mangaId}`);

  const secondaryTitle = cleanText($("h1.title .subtitle").first().text());
  const genres = $(".r-desription .grey a[href*='/tags/genre/']")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  const authors = $(".r-fullstory-spec li")
    .filter((_, element) => $(element).text().trim().startsWith("Authors:"))
    .find("a")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  const language = $(".r-fullstory-spec li")
    .filter((_, element) => $(element).text().trim().startsWith("Language:"))
    .find("a")
    .first()
    .text()
    .trim();
  const status = $(".r-fullstory-spec li")
    .filter((_, element) => $(element).text().toLowerCase().includes("status in coo"))
    .find("a")
    .first()
    .text()
    .trim();
  const rating = Number($("#mc-fs-rate .rate-stat-num .bold").first().text());
  const views = parseCount($(".r-fullstory-spec li[title^='Unique views'] .grey").first().text());
  const tags: Tag[] = genres.map((name) => ({ id: toFilterOptionId(name), title: name }));
  const tagGroups: TagSection[] = tags.length ? [{ id: "genres", title: "Genres", tags }] : [];

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: secondaryTitle ? [secondaryTitle] : [],
      thumbnailUrl: parseImageUrl($(".r-fullstory-poster figure.cover").first()),
      synopsis: parseSynopsis($),
      author: authors.length ? authors.join(", ") : undefined,
      status: status || undefined,
      contentRating: parseContentRating(genres),
      contentType: "novel",
      rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
      tagGroups: tagGroups.length ? tagGroups : undefined,
      additionalInfo: {
        ...(language ? { language } : {}),
        ...(views !== undefined ? { views: String(views) } : {}),
      },
      shareUrl: mangaId,
    },
  };
};

export const parseChapterPage = ($: cheerio.CheerioAPI): RanobesChapterPage => {
  const script = $("script")
    .toArray()
    .map((element) => $(element).text())
    .find((value) => value.includes("window.__DATA__"));
  if (!script) throw new Error("Ranobes: chapter data was not found.");

  const start = script.indexOf("{");
  const end = script.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Ranobes: chapter data was malformed.");

  try {
    return JSON.parse(script.slice(start, end + 1)) as RanobesChapterPage;
  } catch {
    throw new Error("Ranobes: could not parse the chapter list.");
  }
};

const parseChapterTitle = (value: string): { number: number; title?: string } => {
  const title = cleanText(value);
  const match = /^chapter\s+(\d+(?:\.\d+)?)\s*(?:[:.\-–—]\s*)?(.*)$/i.exec(title);
  if (!match) return { number: 0, title };
  const subtitle = cleanText(match[2]);
  return { number: Number(match[1]), title: subtitle || undefined };
};

export const parseChapters = (pages: RanobesChapterPage[], sourceManga: SourceManga): Chapter[] => {
  const entries = pages
    .flatMap((page) => page.chapters ?? [])
    .filter(
      (entry, index, values) =>
        values.findIndex((candidate) => candidate.id === entry.id) === index,
    );
  if (!entries.length) throw new Error(`Ranobes: no chapters found for ${sourceManga.mangaId}`);

  return entries.map((entry, index) => {
    const chapter = parseChapterTitle(entry.title);
    return {
      chapterId: absoluteUrl(entry.link),
      sourceManga,
      langCode: "en",
      chapNum: chapter.number,
      ...(chapter.title ? { title: chapter.title } : {}),
      volume: 0,
      sortingIndex: index,
      publishDate: entry.date ? new Date(entry.date.replace(" ", "T")) : undefined,
    };
  });
};

const toXhtml = (fragment: string): string => {
  const body = cheerio
    .load(fragment, null, false)
    .html({ xml: true })
    .replace(/\s+epub:[\w-]+=(["'])(.*?)\1/gi, "")
    .replace(/\s+xmlns:[\w-]+=(["'])(.*?)\1/gi, "")
    .replace(/\s+on[\w-]+=(["'])(.*?)\1/gi, "")
    .replace(new RegExp(`<(${VOID_TAGS})(\\s[^>]*?)?>`, "gi"), (match, tag, attrs = "") =>
      match.endsWith("/>") ? match : `<${tag}${attrs} />`,
    );
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
};

export const parseChapterDetails = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const article = $("#arrticle").first();
  if (!article.length) {
    throw new Error(`Ranobes: no readable content found for ${chapter.chapterId}`);
  }

  article.find("script, .free-support, .free-support-top, .free-support-bottom, .pubadx").remove();
  article.find("img").each((_, element) => {
    const image = $(element);
    const imageUrl = parseImageUrl(image);
    if (imageUrl) image.attr("src", imageUrl);
    image.removeAttr("data-src");
    image.removeAttr("data-original");
    image.removeAttr("data-lazy-src");
    image.removeAttr("srcset");
  });

  const body = article.html()?.trim();
  if (!body) throw new Error(`Ranobes: empty chapter content for ${chapter.chapterId}`);
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: toXhtml(body),
  };
};
