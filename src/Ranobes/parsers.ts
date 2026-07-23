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
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  DOMAIN,
  VOID_TAGS,
  type FilterTaxonomy,
  type RanobesCard,
  type RanobesChapterPage,
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

const countFrom = (value: string): number | undefined => {
  const digits = value.replace(/[^0-9]/g, "");
  return digits ? Number(digits) : undefined;
};

const imageFrom = (element: cheerio.Cheerio<AnyNode>): string => {
  const src = [
    element.attr("src"),
    element.attr("data-src"),
    element.attr("data-original"),
    element.attr("data-lazy-src"),
  ].find((value) => value?.trim() && !value.includes("data:image"));
  if (src) return absoluteUrl(src);
  const style = element.attr("style") ?? "";
  const match = style.match(/url\(['"]?([^)'"\s]+)['"]?\)/i);
  return match ? absoluteUrl(match[1]) : "";
};

const ratingFrom = (card: cheerio.Cheerio<AnyNode>): { value?: number; count?: number } => {
  const value = Number(card.find(".r-date .rate-drop strong, .rank-story-data-val").first().text());
  const count = countFrom(card.find("[id^='vote-num-id-'], .rank-story-data-info").first().text());
  return { value: Number.isFinite(value) ? value : undefined, count };
};

const viewsFrom = (card: cheerio.Cheerio<AnyNode>): number | undefined => {
  const title = card.find(".meta_author").attr("title") ?? "";
  const value = title.match(/views:\s*([\d\s]+)/i)?.[1] ?? "";
  if (value) return countFrom(value);
  const rankData = card.find(".rank-story-data").first();
  return rankData.find(".fa-eye").length > 0
    ? countFrom(rankData.find(".rank-story-data-val").first().text())
    : undefined;
};

const novelUrlFromChapter = (href: string): string => {
  const url = absoluteUrl(href);
  const path = url.replace(/^https?:\/\/[^/]+/i, "");
  const match = path.match(/^\/([^/]+)-(\d+)\/\d+\.html$/i);
  if (!match) return url;
  const slug = match[1].replace(/-\d+$/, "");
  return `${DOMAIN}/novels/${match[2]}-${slug}.html`;
};

const extractNovelId = (mangaId: string): string => {
  const match = mangaId.match(/\/novels\/(\d+)-/i);
  if (!match) throw new Error(`Ranobes: could not identify novel ${mangaId}`);
  return match[1];
};

const toOptionId = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const parseFilterTaxonomy = (html: string): FilterTaxonomy => {
  const $ = cheerio.load(html);
  const options = (selector: string) =>
    $(selector)
      .first()
      .find("option")
      .toArray()
      .map((element) => cleanText($(element).attr("value") ?? $(element).text()))
      .filter(Boolean)
      .map((title) => ({ id: toOptionId(title), title }));
  return {
    genres: options('select[name="n.genre"]'),
    events: options('select[name="n.events"]'),
  };
};

const contentRatingFromGenres = (genres: string[]): ContentRating => {
  const normalized = genres.map((genre) => genre.toLowerCase());
  if (["adult", "hentai", "smut", "yaoi"].some((genre) => normalized.includes(genre))) {
    return ContentRating.ADULT;
  }
  if (["ecchi", "mature"].some((genre) => normalized.includes(genre))) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

const synopsisFrom = ($: cheerio.CheerioAPI): string => {
  const html = $(".r-desription .cont-text").first().html() ?? "";
  return cleanText(
    html
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\n\s+/g, "\n"),
  );
};

const parseStoryCard = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): RanobesCard | undefined => {
  const link = card.find("h2.title a").first();
  const href = link.attr("href")?.trim();
  const title = cleanText(link.text());
  const imageUrl = imageFrom(card.find("figure.cover").first());
  if (!href || !title || !imageUrl) return undefined;
  const rating = ratingFrom(card);
  const genres = card
    .find(".r-rate .grey a, .rank-story-genre a")
    .toArray()
    .map((element) => $(element).text())
    .map(cleanText)
    .filter(Boolean);
  return {
    mangaId: absoluteUrl(href),
    title,
    imageUrl,
    description: cleanText(
      card.find(".cont-in > div[style*='color'], .moreless__short").first().text(),
    ),
    rating: rating.value,
    ratingCount: rating.count,
    views: viewsFrom(card),
    genres,
  };
};

const parseRankingCard = (
  $: cheerio.CheerioAPI,
  card: cheerio.Cheerio<AnyNode>,
): RanobesCard | undefined => {
  const link = card.find("h2.title a").first();
  const href = link.attr("href")?.trim();
  const title = cleanText(link.text());
  const imageUrl = imageFrom(card.find("figure.fit-cover img").first());
  if (!href || !title || !imageUrl) return undefined;
  const rating = ratingFrom(card);
  return {
    mangaId: absoluteUrl(href),
    title,
    imageUrl,
    description: cleanText(card.find(".moreless__short").first().text()),
    rating: rating.value,
    ratingCount: rating.count,
    views: viewsFrom(card),
    genres: card
      .find(".rank-story-genre a")
      .toArray()
      .map((element) => $(element).text())
      .map(cleanText)
      .filter(Boolean),
  };
};

export const parseListings = (
  html: string,
  type: "stories" | "rankings" | "all" = "all",
): RanobesCard[] => {
  const $ = cheerio.load(html);
  const stories =
    type === "rankings"
      ? []
      : $("article.block.story.shortstory")
          .toArray()
          .flatMap((element) => {
            const card = parseStoryCard($, $(element));
            return card ? [card] : [];
          });
  const rankings =
    type === "stories"
      ? []
      : $("article.rank-story")
          .toArray()
          .flatMap((element) => {
            const card = parseRankingCard($, $(element));
            return card ? [card] : [];
          });
  return [...stories, ...rankings];
};

const parseRelativeDate = (value: string): Date | undefined => {
  const text = value.toLowerCase().trim();
  const number = Number(text.match(/\d+/)?.[0] ?? 0);
  const unit = text.includes("minute")
    ? 60_000
    : text.includes("hour")
      ? 3_600_000
      : text.includes("day")
        ? 86_400_000
        : undefined;
  return unit ? new Date(Date.now() - number * unit) : undefined;
};

export const parseLatestUpdates = (html: string): DiscoverSectionItem[] => {
  const $ = cheerio.load(html);
  return $("div.block.story_line.story_line-img")
    .toArray()
    .flatMap((element) => {
      const item = $(element);
      const link = item.find("a").first();
      const href = link.attr("href")?.trim();
      const title = cleanText(item.find("h3.title").text());
      const chapterTitle = cleanText(item.find(".subtitle").text());
      const imageUrl = imageFrom(item.find("i.image.cover").first());
      if (!href || !title || !imageUrl) return [];
      return [
        {
          type: "chapterUpdatesCarouselItem" as const,
          mangaId: novelUrlFromChapter(href),
          chapterId: absoluteUrl(href),
          title,
          imageUrl,
          subtitle: chapterTitle || undefined,
          publishDate: parseRelativeDate(item.find("em").text()),
          metadata: undefined,
        },
      ];
    });
};

const countText = (value: number): string => value.toLocaleString("en-US");

export const toFeaturedItem = (card: RanobesCard): DiscoverSectionItem => ({
  type: "featuredCarouselItem",
  mangaId: card.mangaId,
  title: card.title,
  imageUrl: card.imageUrl,
  summary: card.description,
  infoItems:
    card.rating !== undefined && card.views !== undefined
      ? [
          {
            symbol: "star.fill",
            text: `${card.rating.toFixed(1)}${card.ratingCount ? ` (${card.ratingCount})` : ""}`,
          },
          { symbol: "eye.fill", text: countText(card.views) },
        ]
      : undefined,
  contentRating: contentRatingFromGenres(card.genres ?? []),
  metadata: undefined,
});

export const toRankingItem = (
  card: RanobesCard,
  index: number,
  useRating: boolean,
): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: card.mangaId,
  title: card.title,
  imageUrl: card.imageUrl,
  subtitle: useRating
    ? `#${index + 1} • ★ ${card.rating?.toFixed(1) ?? "—"}${card.ratingCount ? ` (${card.ratingCount})` : ""}`
    : `#${index + 1} • ${countText(card.views ?? 0)} views`,
  contentRating: contentRatingFromGenres(card.genres ?? []),
  metadata: undefined,
});

export const parseSearchResults = (html: string): SearchResultItem[] => {
  return parseListings(html).map((card) => ({
    mangaId: card.mangaId,
    title: card.title,
    imageUrl: card.imageUrl,
    subtitle: card.rating !== undefined ? `★ ${card.rating.toFixed(1)}` : undefined,
    contentRating: contentRatingFromGenres(card.genres ?? []),
  }));
};

export const hasNextPage = (html: string): boolean => {
  const $ = cheerio.load(html);
  return $(".navigation .page_next a, .pages a").length > 0;
};

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const $ = cheerio.load(html);
  const title = cleanText(
    $("h1.title")
      .first()
      .contents()
      .filter((_, node) => node.type === "text")
      .text(),
  );
  if (!title) throw new Error(`Ranobes: no novel title found for ${mangaId}`);
  const secondaryTitle = cleanText($("h1.title .subtitle").first().text());
  const imageUrl = imageFrom($(".r-fullstory-poster figure.cover").first());
  const genres = $(".r-desription .grey a[href*='/tags/genre/']")
    .toArray()
    .map((element) => $(element).text())
    .map(cleanText)
    .filter(Boolean);
  const author = $(".r-fullstory-spec li")
    .filter((_, element) => $(element).text().trim().startsWith("Authors:"))
    .find("a")
    .first()
    .text()
    .trim();
  const language = $(".r-fullstory-spec li")
    .filter((_, element) => $(element).text().trim().startsWith("Language:"))
    .find("a")
    .first()
    .text()
    .trim();
  const rating = Number($("#mc-fs-rate .rate-stat-num .bold").first().text());
  const views = countFrom($(".r-fullstory-spec li[title^='Unique views'] .grey").first().text());
  const tags: Tag[] = genres.map((name) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: name,
  }));
  const tagGroups: TagSection[] = tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [];
  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: secondaryTitle ? [secondaryTitle] : [],
      thumbnailUrl: imageUrl,
      synopsis: synopsisFrom($),
      author: author || undefined,
      status:
        $(".r-fullstory-spec li")
          .filter((_, element) => $(element).text().toLowerCase().includes("status in coo"))
          .find("a")
          .first()
          .text()
          .trim() || undefined,
      contentRating: contentRatingFromGenres(genres),
      contentType: "novel",
      rating: Number.isFinite(rating) ? Math.min(1, Math.max(0, rating / 5)) : undefined,
      tagGroups: tagGroups.length > 0 ? tagGroups : undefined,
      additionalInfo: {
        ...(language ? { language } : {}),
        ...(views !== undefined ? { views: String(views) } : {}),
      },
      shareUrl: mangaId,
    },
  };
};

export const parseChapterPage = (html: string): RanobesChapterPage => {
  const $ = cheerio.load(html);
  const script = $("script")
    .toArray()
    .map((element) => $(element).text())
    .find((value) => value.includes("window.__DATA__"));
  if (!script) return {};
  const json = script.slice(script.indexOf("{")).trim().replace(/;\s*$/, "");
  try {
    return JSON.parse(json) as RanobesChapterPage;
  } catch (error) {
    throw new Error("Ranobes: could not parse the chapter list.", { cause: error });
  }
};

const chapterNumber = (title: string): number =>
  Number(title.match(/chapter\s+(\d+(?:\.\d+)?)/i)?.[1] ?? 0);

export const parseChapters = (pages: RanobesChapterPage[], sourceManga: SourceManga): Chapter[] =>
  pages
    .flatMap((page) => page.chapters ?? [])
    .filter(
      (entry, index, entries) =>
        entries.findIndex((candidate) => candidate.id === entry.id) === index,
    )
    .map((entry, index) => ({
      chapterId: absoluteUrl(entry.link),
      sourceManga,
      langCode: "en",
      chapNum: chapterNumber(entry.title),
      title: cleanText(entry.title),
      volume: 0,
      sortingIndex: index,
      publishDate: entry.date ? new Date(entry.date.replace(" ", "T")) : undefined,
    }));

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

export const parseChapterDetails = (html: string, chapter: Chapter): ChapterDetails => {
  const $ = cheerio.load(html);
  const article = $("#arrticle").first();
  if (article.length === 0)
    throw new Error(`Ranobes: no readable content found for ${chapter.chapterId}`);
  article.find("script, .free-support, .free-support-top, .free-support-bottom, .pubadx").remove();
  article.find("img").each((_, element) => {
    const image = $(element);
    const src = imageFrom(image);
    if (src) image.attr("src", src);
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

export { extractNovelId, novelUrlFromChapter };
