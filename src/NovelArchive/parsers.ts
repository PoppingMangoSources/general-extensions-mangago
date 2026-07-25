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
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  ADULT_EXCLUSIONS,
  ADULT_RATING_GENRES,
  MATURE_RATING_GENRES,
  DOMAIN,
  GENRES,
  type ChapterContentResponse,
  type Novel,
  type NovelListItem,
  type NovelSource,
  type SearchMetadata,
  type SourceChapterContentResponse,
  type SourceChapterEntry,
  type TriState,
} from "./models";

// Tag slugs use the app's stricter tag-id charset; manga/chapter ids use the wider
// SAFE_ID_REGEX below so their odd characters stay percent-encoded and recoverable.
const SAFE_TAG_REGEX = /[^a-zA-Z0-9._\-@()[\]]/g;
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

const sanitizeId = (value: string): string =>
  value.toLowerCase().replace(SAFE_TAG_REGEX, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

// API ids double as Paperback ids; odd characters are percent-encoded so the original is recoverable.
export const encodeId = (value: string): string =>
  value.replace(SAFE_ID_REGEX, (char) => {
    const encoded = encodeURIComponent(char);
    return encoded !== char ? encoded : "-";
  });

export const decodeId = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const parseCoverUrl = (novel: Novel): string => {
  const path = novel.cover_url ?? novel.image_url ?? novel.novel_image;
  if (!path) return "";
  return path.startsWith("http") ? path : `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;
};

// Site categories that appear in the genres string but are not real genres.
const NON_GENRE_TAGS = new Set([
  "browse",
  "completed novel",
  "completed novels",
  "latest novel",
  "latest novels",
  "anime & comics",
  "anime and comics",
]);

const parseGenres = (novel: Novel): string[] =>
  (novel.genres ?? "")
    .split(",")
    .map((genre) => genre.trim())
    .filter((genre) => genre.length > 0 && !NON_GENRE_TAGS.has(genre.toLowerCase()));

const parseViews = (novel: Novel): number | undefined => {
  const value = novel.views_number ?? novel.views;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const formatCount = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
};

const parseStatus = (novel: Novel): string | undefined => {
  const status = (novel.release_status ?? novel.ongoing)?.trim();
  if (!status) return undefined;
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const cleanDescription = (value?: string | null): string => {
  if (!value) return "";
  return Application.decodeHTMLEntities(value)
    .replace(/\s*show more\s*$/i, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
};

// The API returns HTML-encoded display text; decode entities in every
// user-facing string (titles, aliases, author, chapter names).
const decodeText = (value?: string | null): string =>
  value ? Application.decodeHTMLEntities(value).trim() : "";

const ratingToUnit = (value?: number | null): number | undefined => {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value / 5));
};

const contentRatingForGenres = (genres: string[]): ContentRating => {
  const lower = genres.map((genre) => genre.toLowerCase());
  if (lower.some((genre) => ADULT_RATING_GENRES.includes(genre))) return ContentRating.ADULT;
  if (lower.some((genre) => MATURE_RATING_GENRES.includes(genre))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// Some mirrors double-encode their EPUB text (UTF-8 bytes re-read as Latin-1), so
// repair each run of high bytes that decodes back to valid UTF-8; others are kept.
const repairMojibake = (value: string): string => {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f || code > 0xff) {
      out += value[i];
      i++;
      continue;
    }
    let end = i;
    while (end < value.length) {
      const byte = value.charCodeAt(end);
      if (byte <= 0x7f || byte > 0xff) break;
      end++;
    }
    const bytes = new Uint8Array(end - i);
    for (let k = 0; k < bytes.length; k++) bytes[k] = value.charCodeAt(i + k);
    const decoded = Application.arrayBufferToUTF8String(bytes.buffer);
    // A replacement char means the run was not valid UTF-8, so it was not
    // double-encoded; keep the original bytes rather than mangle them.
    out += decoded.includes(String.fromCharCode(0xfffd)) ? value.slice(i, end) : decoded;
    i = end;
  }
  return out;
};

export const parseNovelList = (novels: Novel[]): NovelListItem[] =>
  novels.map((novel) => {
    // Native chapters are addressed by 1-based position, so the count is the
    // list length; fall back to total_chapters when the array is omitted.
    const listLength = novel.chapter_names?.length ?? 0;
    const chapterCount =
      listLength > 0
        ? listLength
        : parseInt(String(novel.total_chapters ?? "").replace(/\D/g, ""), 10) || 0;
    const date = novel.updated_at ? new Date(novel.updated_at) : undefined;
    const genres = parseGenres(novel);
    return {
      mangaId: encodeId(String(novel.id)),
      title: decodeText(novel.title),
      imageUrl: parseCoverUrl(novel),
      contentRating: contentRatingForGenres(genres),
      genres,
      summary: cleanDescription(novel.description) || undefined,
      rating: novel.rating ?? undefined,
      views: parseViews(novel),
      chapterCount,
      publishDate: date && !Number.isNaN(date.getTime()) ? date : undefined,
    };
  });

export const toFeaturedItem = (
  item: NovelListItem,
  index: number,
  variant: "trending" | "editors",
): DiscoverSectionItem => {
  const viewsInfo =
    item.views === undefined
      ? undefined
      : { symbol: "eye.fill" as const, text: formatCount(item.views) };
  const rankInfo = { symbol: "flame.fill" as const, text: `${index + 1}` };
  const infoItems: FeaturedCarouselItem["infoItems"] =
    variant === "trending"
      ? viewsInfo
        ? [rankInfo, viewsInfo]
        : [rankInfo]
      : viewsInfo
        ? [viewsInfo]
        : undefined;
  return {
    type: "featuredCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    supertitle: item.genres.join(", ") || undefined,
    summary: item.summary,
    infoItems,
    contentRating: item.contentRating,
  };
};

export const toCardItem = (
  item: NovelListItem,
  variant: "rating" | "chapters",
): DiscoverSectionItem => {
  const lead =
    variant === "chapters"
      ? item.chapterCount > 0
        ? `Ch. ${item.chapterCount}`
        : undefined
      : item.rating != null
        ? `★ ${item.rating.toFixed(1)}`
        : undefined;
  return {
    type: "simpleCarouselItem",
    mangaId: item.mangaId,
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle:
      [lead, item.genres[0]].filter((value): value is string => Boolean(value)).join(" • ") ||
      undefined,
    contentRating: item.contentRating,
  };
};

export const toChapterUpdateItem = (item: NovelListItem): DiscoverSectionItem | undefined => {
  if (item.chapterCount <= 0) return undefined;
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: item.mangaId,
    chapterId: String(item.chapterCount),
    imageUrl: item.imageUrl,
    title: item.title,
    subtitle:
      [`Ch. ${item.chapterCount}`, item.genres[0]]
        .filter((value): value is string => Boolean(value))
        .join(" • ") || undefined,
    publishDate: item.publishDate,
    contentRating: item.contentRating,
  };
};

export const toGenreCarouselItems = (hideAdult: boolean): DiscoverSectionItem[] =>
  GENRES.filter((genre) => !hideAdult || !ADULT_EXCLUSIONS.includes(genre.value)).map((genre) => ({
    type: "genresCarouselItem",
    name: genre.value,
    searchQuery: {
      title: "",
      metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
    },
  }));

export const toSearchResultItem = (item: NovelListItem): SearchResultItem => ({
  mangaId: item.mangaId,
  title: item.title,
  imageUrl: item.imageUrl,
  subtitle:
    [item.rating != null ? `★ ${item.rating.toFixed(1)}` : undefined, item.genres[0]]
      .filter((value): value is string => Boolean(value))
      .join(" • ") || undefined,
  contentRating: item.contentRating,
});

export const parseMangaDetails = (novel: Novel): SourceManga => {
  const primaryTitle = decodeText(novel.title) || "Untitled";
  const seen = new Set([primaryTitle.toLowerCase()]);
  const secondaryTitles: string[] = [];
  for (const alias of novel.associated_names ?? []) {
    const title = decodeText(alias);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    secondaryTitles.push(title);
  }

  const genres = parseGenres(novel);
  const tags: Tag[] = genres.map((genre) => ({ id: sanitizeId(genre), title: genre }));

  const percentage = ratingToUnit(novel.rating);
  const additionalInfo =
    percentage === undefined
      ? undefined
      : {
          rating: `${Math.round(percentage * 100)}%${
            novel.rating_count ? ` · ${novel.rating_count} ratings` : ""
          }`,
        };

  return {
    mangaId: encodeId(String(novel.id)),
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: parseCoverUrl(novel),
      synopsis: cleanDescription(novel.description),
      author: decodeText(novel.author) || undefined,
      status: parseStatus(novel),
      rating: percentage,
      contentRating: contentRatingForGenres(genres),
      contentType: "novel",
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : undefined,
      additionalInfo,
      shareUrl: `${DOMAIN}/novel?id=${novel.id}`,
    },
  };
};

const CHAPTER_LEAD = /^\s*(?:chapter|chap\.?|ch\.?|episode|ep\.?)?\s*(\d+(?:\.\d+)?)\s*[-:–.]?\s*/i;

const cleanChapterName = (name: string): { chapNum?: number; title: string } => {
  const decoded = Application.decodeHTMLEntities(name);
  const match = decoded.match(CHAPTER_LEAD);
  const parsed = match ? parseFloat(match[1]) : NaN;
  const title = (match ? decoded.slice(match[0].length) : decoded)
    .replace(/^\d+(?:\.\d+)?\s*[-:–.]\s*/, "")
    .trim();
  return { chapNum: Number.isFinite(parsed) ? parsed : undefined, title };
};

// The API exposes no per-chapter dates; callers pass one shared stable
// timestamp so chapter ages don't drift to when the list was fetched.
export const novelUpdatedAt = (novel: Novel): Date | undefined => {
  if (!novel.updated_at) return undefined;
  const date = new Date(novel.updated_at);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) return undefined;
  return date;
};

export const parseChapters = (
  novel: Novel,
  sourceManga: SourceManga,
  publishDate?: Date,
): Chapter[] =>
  (novel.chapter_names ?? []).map((rawName, index) => {
    const { chapNum, title } = cleanChapterName((rawName ?? "").trim());
    const chapterNumber = chapNum ?? index + 1;
    return {
      // Native chapters are addressed by list position, so it is the id.
      chapterId: String(index + 1),
      sourceManga,
      langCode: "en",
      chapNum: chapterNumber,
      title: title || `Chapter ${chapterNumber}`,
      // Marks native chapters apart from mirror-source ones (which use the mirror's label).
      version: "NovelArchive",
      volume: 0,
      sortingIndex: index,
      publishDate,
    };
  });

export const parseSourceChapters = (
  source: NovelSource,
  entries: SourceChapterEntry[],
  sourceManga: SourceManga,
  publishDate?: Date,
): Chapter[] =>
  entries.map((entry, index) => {
    const parsed =
      typeof entry.number === "number" ? entry.number : parseFloat(String(entry.number));
    const chapNum = Number.isFinite(parsed) ? parsed : index + 1;
    const { title } = cleanChapterName((entry.title ?? "").trim());
    return {
      chapterId: `${encodeId(source.id)}:${encodeId(String(entry.number))}`,
      sourceManga,
      langCode: "en",
      chapNum,
      title: title || `Chapter ${chapNum}`,
      version: source.label ?? source.id,
      volume: 0,
      sortingIndex: index,
      publishDate,
    };
  });

// The reader parses chapters as XHTML, so escape content into closed tags.
const wrapXhtml = (bodyHtml: string, heading: string): string => {
  const title = heading ? `<h2>${escapeXml(heading)}</h2>` : "";
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/></head><body>${title}${bodyHtml}</body></html>`;
};

// Native chapters arrive as plain text; each line becomes a paragraph.
const textToXhtml = (text: string, heading: string): string =>
  wrapXhtml(
    text
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `<p>${escapeXml(line)}</p>`)
      .join(""),
    heading,
  );

const chapterHeading = (chapter: Chapter): string =>
  chapter.title ?? (chapter.chapNum ? `Chapter ${chapter.chapNum}` : "");

// Mirror sources arrive as HTML; serialize through cheerio so the original
// structure survives instead of being flattened to plain text.
const htmlToXhtml = (html: string, heading: string): string =>
  wrapXhtml(cheerio.load(html, null, false).html({ xml: true }), heading);

export const parseChapterDetails = (
  response: ChapterContentResponse,
  chapter: Chapter,
): ChapterDetails => {
  const content = repairMojibake((response.chapter?.content ?? response.content ?? "").trim());
  if (!content) {
    throw new Error(`No content returned for chapter ${chapter.chapterId}`);
  }
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: textToXhtml(content, chapterHeading(chapter)),
  };
};

export const parseSourceChapterDetails = (
  response: SourceChapterContentResponse,
  chapter: Chapter,
): ChapterDetails => {
  const html = repairMojibake(
    (response.content_html ?? response.chapter?.content_html ?? response.content ?? "").trim(),
  );
  if (!html) {
    throw new Error(`No content returned for chapter ${chapter.chapterId}`);
  }
  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: htmlToXhtml(html, chapterHeading(chapter)),
  };
};

const GENRE_VALUE_BY_ID = new Map(GENRES.map((genre) => [genre.id, genre.value]));

export const pickGenreValues = (
  genres: TriState | undefined,
  state: "included" | "excluded",
): string[] =>
  Object.entries(genres ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => GENRE_VALUE_BY_ID.get(id) ?? id);

export const dedupe = (values: string[]): string[] => [...new Set(values)];
