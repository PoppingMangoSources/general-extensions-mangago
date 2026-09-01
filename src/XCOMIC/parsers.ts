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

import {
  CONTENT_RATING_GENRES,
  CONTENT_RATING_OPTIONS,
  DOMAIN,
  FORMAT_OPTIONS,
  TAG_TITLE_OVERRIDES,
  TRANSLATED_LANGUAGE_KEY,
  type ChapterData,
  type ChapterPagesResponse,
  type ComicData,
  type ComicNode,
  type ContentPreferenceRating,
  type FilterOptions,
  type LatestUploadsResult,
  type XComicPreferences,
} from "./models";

const PORNOGRAPHIC_GENRES = new Set<string>(CONTENT_RATING_GENRES.pornographic);
const EROTICA_GENRES = new Set<string>(CONTENT_RATING_GENRES.erotica);
const SUGGESTIVE_GENRES = new Set<string>(CONTENT_RATING_GENRES.suggestive);
// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
const sanitizeId = (value: string): string => value.replace(SAFE_ID_REGEX, "-");

const toAbsoluteUrl = (url: string | null | undefined): string => {
  if (typeof url !== "string" || !url.trim()) return "";
  const normalized = url.trim();
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith("//")) return `https:${normalized}`;
  return `${DOMAIN}${normalized.startsWith("/") ? "" : "/"}${normalized}`;
};

const hasCoverUrl = (url: string | null | undefined): url is string =>
  typeof url === "string" && url.trim().length > 0;

const titleCase = (value: string): string =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const parseFilterOptions = (html: string): FilterOptions => {
  const $ = cheerio.load(html);
  const filterGroup = (name: string): Tag[] => {
    const seen = new Set<string>();
    return $("details.group")
      .filter((_, element) =>
        $(element).find("summary").first().text().trim().toLowerCase().includes(name),
      )
      .first()
      .find("div")
      .map((_, element): Tag | undefined => {
        const raw = $(element).attr(":")?.trim();
        const title = $(element).find("span").first().text().trim();
        if (!raw || !title) return undefined;
        // Sanitized here and in toSourceManga alike, so a tapped tag matches a filter id.
        const id = sanitizeId(raw);
        if (seen.has(id)) return undefined;
        seen.add(id);
        return { id, title: Application.decodeHTMLEntities(title) };
      })
      .get()
      .filter((option): option is Tag => option !== undefined);
  };

  const formatIds = new Set(FORMAT_OPTIONS.map(({ id }) => id));
  const options = {
    contentRatings: filterGroup("content rating"),
    demographics: filterGroup("demographics"),
    genres: filterGroup("genres").filter(({ id }) => !formatIds.has(id)),
    types: filterGroup("types"),
  };
  // An empty single group degrades that one picker; losing both of these means the scrape broke.
  if (!options.genres.length && !options.types.length) {
    throw new Error("XCOMIC returned incomplete search filters");
  }
  return options;
};

// The API filters on the declared rating alone, so genres and tags are escalated here as well.
const contentPreferenceRating = (comic: ComicData): ContentPreferenceRating => {
  const taxonomy = [...(comic.genres ?? []), ...(comic.tags ?? [])].map((value) =>
    value.trim().toLowerCase(),
  );
  const rating = comic.contentRating?.trim().toLowerCase();
  // A rating the API adds later stays gated at the top instead of passing through as safe.
  if (rating && !CONTENT_RATING_OPTIONS.some((option) => option.id === rating)) {
    return "pornographic";
  }
  if (rating === "pornographic" || taxonomy.some((value) => PORNOGRAPHIC_GENRES.has(value))) {
    return "pornographic";
  }
  if (rating === "erotica" || taxonomy.some((value) => EROTICA_GENRES.has(value))) {
    return "erotica";
  }
  if (
    rating === "suggestive" ||
    comic.sfw_result === false ||
    taxonomy.some((value) => SUGGESTIVE_GENRES.has(value))
  ) {
    return "suggestive";
  }
  return "safe";
};

const toContentRating = (comic: ComicData): ContentRating => {
  const rating = contentPreferenceRating(comic);
  if (rating === "erotica" || rating === "pornographic") return ContentRating.ADULT;
  if (rating === "suggestive") return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

export const isComicAllowed = (
  comic: ComicData,
  preferences: XComicPreferences,
  // Feeds that carry every language at once cannot be narrowed server-side, so they filter here.
  restrictToPreferredLanguages = false,
): boolean => {
  if (
    !preferences.contentRatings.length ||
    !preferences.types.length ||
    !hasCoverUrl(comic.urlCover)
  ) {
    return false;
  }
  if (
    restrictToPreferredLanguages &&
    comic.translatedLanguage &&
    !preferences.languages.includes(comic.translatedLanguage)
  ) {
    return false;
  }
  if (comic.type && !preferences.types.includes(comic.type)) {
    return false;
  }
  if (!preferences.contentRatings.includes(contentPreferenceRating(comic))) return false;
  const excluded = new Set([...preferences.excludedGenres, ...preferences.excludedFormats]);
  return ![...(comic.genres ?? []), ...(comic.tags ?? [])].some((id) => excluded.has(id));
};

// Discover cards and the chapter list must agree, or a card cannot be matched to its chapter.
const toChapterId = (chapter: { id: string; urlPath?: string | null }): string =>
  sanitizeId(chapter.urlPath ?? `/comic/chapter/${chapter.id}`);

const chapterNumber = (chapter?: ChapterData | null): number | undefined => {
  const value = chapter?.chaNum ?? chapter?.serial;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const formatChapter = (chapter?: ChapterData | null): string | undefined => {
  const number =
    chapterNumber(chapter) ??
    /(?:chapter|ch\.?)[\s_]*(\d+(?:\.\d+)?)/i.exec(chapter?.dname ?? "")?.[1];
  if (number == null) return undefined;
  return `Ch. ${String(number).replace(/\.0$/, "")}`;
};

const dateFromTimestamp = (value?: number | null): Date | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const formatType = (type?: string | null): string | undefined =>
  type ? titleCase(type) : undefined;

const originalTitleForCard = (comic: ComicData): string | undefined => {
  const nativeTitlePattern =
    comic.type === "manhwa"
      ? /[\uAC00-\uD7A3]/
      : comic.type === "manga"
        ? /[\u3040-\u30FF\u31F0-\u31FF]/
        : comic.type === "manhua"
          ? /[\u3400-\u4DBF\u4E00-\u9FFF]/
          : undefined;
  const nativeTitle = nativeTitlePattern
    ? comic.altNames?.find((title) => nativeTitlePattern.test(title))
    : undefined;
  if (nativeTitle) return Application.decodeHTMLEntities(nativeTitle);

  // Alternative titles have no language labels, so reject obvious English titles as fallbacks.
  const primaryTitle = comic.name.trim().toLowerCase();
  const romanizedTitle = comic.altNames?.find((title) => {
    const normalized = title.trim();
    return (
      normalized.toLowerCase() !== primaryTitle &&
      /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/.test(normalized) &&
      /^[\u0020-\u007E\u00C0-\u024F\u1E00-\u1EFF]+$/.test(normalized) &&
      !/\b(?:the|of|and|my|with|for|from|this|that|your|our|into|after|before|under|over|when|where|who|how)\b/i.test(
        normalized,
      )
    );
  });
  return romanizedTitle ? Application.decodeHTMLEntities(romanizedTitle) : undefined;
};

const baseCard = (node: ComicNode) => ({
  mangaId: sanitizeId(node.data.id),
  title: Application.decodeHTMLEntities(node.data.name),
  imageUrl: toAbsoluteUrl(node.data.urlCover),
  contentRating: toContentRating(node.data),
});

const cardSubtitle = (comic: ComicData): string | undefined =>
  [formatChapter(comic.chapterNodes_last?.[0]?.data), formatType(comic.type)]
    .filter((value): value is string => Boolean(value))
    .join(" • ") || undefined;

export const toSearchResultItem = (node: ComicNode): SearchResultItem => ({
  ...baseCard(node),
  subtitle: cardSubtitle(node.data),
});

type CarouselItemType =
  | "featuredCarouselItem"
  | "simpleCarouselItem"
  | "chapterUpdatesCarouselItem";

export const toDiscoverItems = (
  nodes: ComicNode[],
  type: CarouselItemType,
): DiscoverSectionItem[] =>
  nodes
    .map((node) => toDiscoverItem(node, type))
    .filter((item): item is DiscoverSectionItem => item !== undefined);

const toDiscoverItem = (
  node: ComicNode,
  type: CarouselItemType,
): DiscoverSectionItem | undefined => {
  const chapter = node.data.chapterNodes_last?.[0]?.data;
  if (type === "featuredCarouselItem") {
    const chapters = node.data.chaps_normal ?? chapterNumber(chapter);
    const comicType = formatType(node.data.type);
    const chapterInfo =
      chapters != null ? { symbol: "book.fill", text: `${chapters} Chapters` } : undefined;
    const typeInfo = comicType ? { symbol: "books.vertical.fill", text: comicType } : undefined;
    const infoItems: Extract<DiscoverSectionItem, { type: "featuredCarouselItem" }>["infoItems"] =
      chapterInfo && typeInfo
        ? [chapterInfo, typeInfo]
        : chapterInfo
          ? [chapterInfo]
          : typeInfo
            ? [typeInfo]
            : undefined;
    return {
      type,
      ...baseCard(node),
      supertitle: originalTitleForCard(node.data),
      summary: stripHtml(node.data.summary?.html) || undefined,
      infoItems,
    };
  }
  if (type === "chapterUpdatesCarouselItem") {
    if (!chapter?.id) return undefined;
    return {
      type,
      ...baseCard(node),
      chapterId: toChapterId(chapter),
      subtitle: cardSubtitle(node.data),
      publishDate: dateFromTimestamp(
        chapter.datePublic ?? chapter.dateModify ?? chapter.dateCreate,
      ),
    };
  }
  return { type, ...baseCard(node), subtitle: cardSubtitle(node.data) };
};

export const toLatestUploadNodes = (result?: LatestUploadsResult | null): ComicNode[] => {
  if (!result || !Array.isArray(result.items)) {
    throw new Error("XCOMIC latest-upload results were missing");
  }
  return result.items.flatMap(({ comic, chapters }) => {
    const data = comic?.data;
    const chapterNodes = chapters ?? [];
    if (!data || !hasCoverUrl(data.urlCover) || !chapterNodes[0]?.data.id) {
      return [];
    }
    return [
      {
        data: {
          ...data,
          chapterNodes_last: chapterNodes,
        },
      },
    ];
  });
};

const nodeNames = (nodes?: Array<{ data?: { name?: string } | null } | null> | null): string[] =>
  nodes
    ?.map((node) => node?.data?.name?.trim())
    .filter((name): name is string => Boolean(name))
    .map((name) => Application.decodeHTMLEntities(name)) ?? [];

const stripHtml = (html?: string | null): string => {
  if (!html) return "";
  const $ = cheerio.load(html);
  $("br").replaceWith("\n");
  $("p, div, li, blockquote").each((_, element) => {
    $(element).append("\n");
  });
  return Application.decodeHTMLEntities(
    $.root()
      .text()
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
};

const formatDateYmd = (value: ComicData["originalPubFrom"]): string | undefined => {
  if (!value?.y) return undefined;
  return [value.y, value.m?.toString().padStart(2, "0"), value.d?.toString().padStart(2, "0")]
    .filter(Boolean)
    .join("-");
};

export const toSourceManga = (node: ComicNode): SourceManga => {
  const comic = node.data;
  const authors = nodeNames(comic.authorNodes);
  const artists = nodeNames(comic.artistNodes);
  const distinctArtists = artists.filter((artist) => !authors.includes(artist));
  const toTags = (values: string[]): Tag[] =>
    [...new Set(values.map(sanitizeId))].map((id) => ({
      id,
      title: TAG_TITLE_OVERRIDES[id] ?? titleCase(id),
    }));
  const tagGroups: TagSection[] = [
    { id: "genres", title: "Genres", tags: toTags(comic.genres ?? []) },
    { id: "demographics", title: "Demographics", tags: toTags(comic.demographics ?? []) },
    { id: "tags", title: "Tags", tags: toTags(comic.tags ?? nodeNames(comic.tagNodes)) },
  ].filter((group) => group.tags.length > 0);

  const publicationFrom = formatDateYmd(comic.originalPubFrom);
  const publicationTill = formatDateYmd(comic.originalPubTill);
  const rating =
    typeof comic.score_val === "number" && Number.isFinite(comic.score_val)
      ? Math.min(1, Math.max(0, comic.score_val / 10))
      : undefined;
  const cover = toAbsoluteUrl(comic.urlCover);
  const publishers = nodeNames(comic.publisherNodes);

  return {
    mangaId: sanitizeId(comic.id),
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(comic.name),
      secondaryTitles: (comic.altNames ?? []).map((title) => Application.decodeHTMLEntities(title)),
      thumbnailUrl: cover,
      synopsis: stripHtml(comic.summary?.html),
      author: authors.join(", ") || undefined,
      artist: distinctArtists.join(", ") || undefined,
      contentRating: toContentRating(comic),
      rating,
      status: titleCase(comic.originalStatus || comic.uploadStatus || "unknown"),
      tagGroups,
      artworkUrls: cover ? [cover] : undefined,
      additionalInfo: {
        ...(comic.type ? { Type: titleCase(comic.type) } : {}),
        ...(comic.originalLanguage ? { "Original Language": comic.originalLanguage } : {}),
        ...(comic.translatedLanguage
          ? { [TRANSLATED_LANGUAGE_KEY]: comic.translatedLanguage }
          : {}),
        ...(publicationFrom
          ? {
              Publication: publicationTill
                ? `${publicationFrom} – ${publicationTill}`
                : publicationFrom,
            }
          : {}),
        ...(comic.originalPubZone ? { Region: comic.originalPubZone } : {}),
        ...(typeof comic.chaps_normal === "number" ? { Chapters: String(comic.chaps_normal) } : {}),
        ...(typeof comic.follows === "number" ? { Follows: String(comic.follows) } : {}),
        ...(typeof comic.reviews === "number" ? { Reviews: String(comic.reviews) } : {}),
        ...(typeof comic.comments_total === "number"
          ? { Comments: String(comic.comments_total) }
          : {}),
        ...(publishers.length > 0 ? { Publishers: publishers.join(", ") } : {}),
      },
      shareUrl: toAbsoluteUrl(comic.urlPath || `/comic/${comic.id}`),
    },
  };
};

export const toChapter = (data: ChapterData, sourceManga: SourceManga): Chapter => {
  const title = [data.dname?.trim(), data.title?.trim()]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => index === 0 || value !== values[0])
    .map((value) => Application.decodeHTMLEntities(value))
    .join(": ");
  const sourceName = data.srcName?.trim();
  const profileNames = nodeNames(data.profileNodes);
  const scanlators = sourceName
    ? [Application.decodeHTMLEntities(sourceName.charAt(0).toUpperCase() + sourceName.slice(1))]
    : profileNames.length > 0
      ? profileNames
      : nodeNames(data.groupNodes);
  const uploaderName = data.userNode?.data?.name?.trim();
  const uploader = uploaderName ? Application.decodeHTMLEntities(uploaderName) : undefined;
  const language = sourceManga.mangaInfo.additionalInfo?.[TRANSLATED_LANGUAGE_KEY];
  const langCode =
    typeof language === "string" && language
      ? language === "_t"
        ? "und"
        : language.replaceAll("_", "-")
      : "en";

  return {
    chapterId: toChapterId(data),
    sourceManga,
    chapNum: chapterNumber(data) ?? 0,
    volume: 0,
    title: title || undefined,
    langCode,
    publishDate: dateFromTimestamp(data.dateModify ?? data.dateCreate ?? data.datePublic),
    version: scanlators.join(", ") || uploader || undefined,
  };
};

export const parseChapterDetails = (
  response: ChapterPagesResponse,
  chapter: Chapter,
): ChapterDetails => {
  const pages = (response.get_chapterNode?.data?.imageUrls ?? [])
    .map(toAbsoluteUrl)
    .filter(Boolean);
  if (!pages.length) throw new Error("XCOMIC returned no chapter images");
  return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
};
