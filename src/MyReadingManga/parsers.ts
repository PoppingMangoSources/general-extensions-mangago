/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";
import { type Cheerio, type CheerioAPI } from "cheerio";
import { type AnyNode } from "domhandler";

import { DOMAIN, LANGUAGES, type FilterTaxonomies, type MangaCard } from "./models";

const IMAGE_EXTENSION = /\.(jpg|jpeg|png|webp|gif|avif)/i;

// Paperback rejects IDs with characters outside its allowed set.
const sanitizeId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

// Entry titles embed the circle/author and language, e.g.
// "[Author] Title [Eng] (Update)"; strip both for the display title.
const cleanTitle = (raw: string): string => {
  const withoutBrackets = raw.replace(/\[[^\]]*\]/g, "").trim();
  const parenIndex = withoutBrackets.lastIndexOf("(");
  return (parenIndex > 0 ? withoutBrackets.slice(0, parenIndex) : withoutBrackets).trim();
};

const bracketAuthor = (raw: string): string | undefined => {
  const match = raw.match(/\[([^\]]+)\]/);
  return match ? match[1].trim() : undefined;
};

const imageFrom = (img: Cheerio<AnyNode>): string => {
  for (const attr of ["data-src", "data-cfsrc", "src", "data-lazy-src"]) {
    const value = (img.attr(attr) || "").trim();
    if (IMAGE_EXTENSION.test(value)) {
      if (value.startsWith("http")) return value;
      if (value.startsWith("//")) return `https:${value}`;
      if (value.startsWith("/")) return `${DOMAIN}${value}`;
    }
  }
  return "";
};

// WordPress thumbnails append a size suffix ("-150x216.jpg"); the original
// image lives at the unsuffixed URL.
const stripThumbnailSize = (src: string): string => src.replace(/-\d+x\d+(\.\w+)$/, "$1");

export const toMangaId = (href: string): string =>
  href
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");

export const parseListing = ($: CheerioAPI, languageClasses: string[]): MangaCard[] => {
  const cards: MangaCard[] = [];
  const seen = new Set<string>();

  for (const element of $("article, div.post, div.item, ul.wpp-list li").toArray()) {
    const article = $(element);
    const classes = article.attr("class") ?? "";
    if (classes.includes("category-video")) continue;
    if (
      languageClasses.length > 0 &&
      classes.includes("lang-") &&
      !languageClasses.some((language) => classes.includes(`lang-${language}`))
    ) {
      continue;
    }

    const link = article
      .find(".entry-title a, h1 a, h2 a, h3 a, a.wpp-post-title, a[rel=bookmark]")
      .first();
    const href = (link.attr("href") || "").trim();
    const title = cleanTitle(Application.decodeHTMLEntities(link.text().trim()));
    if (!href || !title) continue;

    const mangaId = toMangaId(href);
    if (!mangaId || seen.has(mangaId)) continue;
    seen.add(mangaId);

    const image = article.find("img.post-image, img.entry-image, img.wpp-thumbnail, img").first();
    cards.push({
      mangaId,
      title,
      imageUrl: stripThumbnailSize(imageFrom(image)),
    });
  }

  return cards;
};

export const hasNextPage = ($: CheerioAPI): boolean =>
  $("a.next.page-numbers, li.pagination-next").length > 0;

const detectLanguageCode = ($: CheerioAPI): string => {
  for (const element of $("p.entry-meta span.entry-terms").toArray()) {
    const span = $(element);
    if (!span.find(".meta-label").first().text().includes("Lang")) continue;
    const name = span.find("a").first().text().trim().toLowerCase();
    const language = LANGUAGES.find((entry) => entry.name.toLowerCase() === name);
    if (language) return language.code;
  }
  return "en";
};

const yoastThumbnail = ($: CheerioAPI): string => {
  const schema = $("script.yoast-schema-graph").first().text();
  const match = schema.match(/"thumbnailUrl":"([^"]+)"/);
  return match ? match[1].replaceAll("\\/", "/") : "";
};

export const parseMangaDetails = ($: CheerioAPI, mangaId: string): SourceManga => {
  const heading = Application.decodeHTMLEntities($("h1.entry-title, h1").first().text().trim());
  const author = bracketAuthor(heading);

  const thumbnailUrl =
    yoastThumbnail($) ||
    imageFrom($("img.img-myreadingmanga").first()) ||
    imageFrom($("div.entry-content img").first());

  const collectTags = (selector: string): Tag[] => {
    const tags: Tag[] = [];
    const seen = new Set<string>();
    for (const element of $(selector).toArray()) {
      const title = Application.decodeHTMLEntities($(element).text().trim());
      if (!title) continue;
      const id = sanitizeId(title);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      tags.push({ id, title });
    }
    return tags;
  };

  const tagGroups: TagSection[] = [];
  const genres = collectTags(".entry-header a[href*='/genre/']");
  const tags = collectTags(".entry-header a[href*='/tag/']");
  const categories = collectTags("span.entry-categories a");
  if (genres.length > 0) tagGroups.push({ id: "genres", title: "Genres", tags: genres });
  if (tags.length > 0) tagGroups.push({ id: "tags", title: "Tags", tags });
  if (categories.length > 0) {
    tagGroups.push({ id: "categories", title: "Categories", tags: categories });
  }

  const scanGroups = $(".entry-terms a[href*='/group/']")
    .toArray()
    .map((element) => $(element).text().trim())
    .filter(Boolean);
  const paragraphs = $("div.entry-content p")
    .toArray()
    .map((element) => Application.decodeHTMLEntities($(element).text().trim()))
    .filter((text) => text.length > 0 && !text.includes("|"));
  const synopsis = [
    scanGroups.length > 0 ? `Scanlated by: ${scanGroups.join(", ")}` : "",
    ...paragraphs,
  ]
    .filter(Boolean)
    .join("\n");

  const statusText = $("a[href*='/status/']").first().text().trim();

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: cleanTitle(heading),
      secondaryTitles: [],
      thumbnailUrl,
      synopsis,
      author,
      artist: author,
      status: statusText || undefined,
      contentRating: ContentRating.ADULT,
      tagGroups: tagGroups.length > 0 ? tagGroups : undefined,
      shareUrl: `${DOMAIN}/${mangaId}/`,
    },
  };
};

// Entries are single posts split into numbered pages; the pagination links
// reveal the part count and each part reads as one chapter.
export const parseChapters = ($: CheerioAPI, sourceManga: SourceManga): Chapter[] => {
  const langCode = detectLanguageCode($);
  const publishDateText = $(".entry-time").first().text().trim();
  const publishDate = publishDateText ? new Date(publishDateText) : undefined;

  const partNumbers = $("a.page-numbers:not(.next):not(.prev)")
    .toArray()
    .map((element) => parseInt($(element).text().trim(), 10))
    .filter((value) => !isNaN(value));
  const lastPart = Math.max(1, ...partNumbers);

  const chapters: Chapter[] = [];
  for (let part = lastPart; part >= 1; part--) {
    chapters.push({
      chapterId: String(part),
      sourceManga,
      langCode,
      chapNum: part,
      title: `Part ${part}`,
      volume: 0,
      publishDate: publishDate && !isNaN(publishDate.getTime()) ? publishDate : undefined,
    });
  }
  return chapters;
};

export const parsePages = ($: CheerioAPI, chapter: Chapter): ChapterDetails => {
  const pages: string[] = [];
  const seen = new Set<string>();
  for (const element of $("div.entry-content img, div.separator img").toArray()) {
    const src = imageFrom($(element));
    if (!src || seen.has(src)) continue;
    seen.add(src);
    pages.push(src);
  }

  if (pages.length === 0) {
    throw new Error(
      `MyReadingManga: no pages found for chapter ${chapter.chapterId} — the entry may be a video post or the site is showing a challenge`,
    );
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};

// The search sidebar exposes one widget per filterable taxonomy.
export const parseFilterTaxonomies = ($: CheerioAPI): FilterTaxonomies => {
  const widgetIds: Record<string, string> = {
    genre: "genre",
    category: "category",
    tag: "tag",
    "circle/ artist": "artist",
    pairing: "pairing",
    status: "status",
  };

  const taxonomies: FilterTaxonomies = {};
  for (const element of $("aside.ep-search-sidebar div.ep-filter-widget").toArray()) {
    const widget = $(element);
    const title = widget.find("h3.ep-filter-title").first().text().trim().toLowerCase();
    const id = widgetIds[title];
    if (!id) continue;

    const options = widget
      .find("div.term")
      .toArray()
      .flatMap((term) => {
        const name = ($(term).attr("data-term-name") || "").trim();
        const slug = ($(term).attr("data-term-slug") || "").trim();
        return name && slug ? [{ id: slug, title: name }] : [];
      });
    if (options.length > 0) taxonomies[id] = options;
  }
  return taxonomies;
};
