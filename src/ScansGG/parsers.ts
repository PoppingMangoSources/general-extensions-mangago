/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type DiscoverSectionItem,
  type FeaturedCarouselItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import { getContentPreference, getDomain, getHiddenGenreIds } from "./forms/settings";
import {
  ADULT_TAG_IDS,
  CDN_URL,
  mapStatus,
  MATURE_TAG_IDS,
  TAGS_MAP,
  TYPE_NAMES,
  type ChapterDto,
  type LatestChapterDto,
  type PageListDto,
  type SeriesDto,
  type SearchMetadata,
  type TriStateSelection,
  type TriStateValue,
} from "./models";

export interface ContentFilters {
  allowAllContent: boolean;
  hiddenGenreIds: Set<number>;
}

export const getContentFilters = (): ContentFilters => ({
  allowAllContent: getContentPreference() === "all",
  hiddenGenreIds: new Set(getHiddenGenreIds().map(Number)),
});

export const getSelectedIds = (
  selection: TriStateSelection | undefined,
  state: TriStateValue,
): string[] =>
  Object.entries(selection ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => id);

export const isGenreVisible = (tagId: string, filters: ContentFilters): boolean => {
  const numericId = Number(tagId);
  if (filters.hiddenGenreIds.has(numericId)) return false;
  if (filters.allowAllContent) return true;
  return !ADULT_TAG_IDS.has(numericId) && !MATURE_TAG_IDS.has(numericId);
};

const matchesSingleValue = (
  value: number | null | undefined,
  selection: TriStateSelection | undefined,
): boolean => {
  const id = value == null ? undefined : String(value);
  const included = getSelectedIds(selection, "included");
  const excluded = new Set(getSelectedIds(selection, "excluded"));
  if (id !== undefined && excluded.has(id)) return false;
  return included.length === 0 || (id !== undefined && included.includes(id));
};

const matchesTags = (tags: Set<number>, metadata: SearchMetadata | undefined): boolean => {
  const included = getSelectedIds(metadata?.tags, "included").map(Number);
  const excluded = getSelectedIds(metadata?.tags, "excluded").map(Number);
  if (excluded.some((id) => tags.has(id))) return false;
  if (included.length === 0) return true;
  return metadata?.tagMatchMode === "or"
    ? included.some((id) => tags.has(id))
    : included.every((id) => tags.has(id));
};

export const seriesMatchesFilters = (
  series: SeriesDto,
  metadata: SearchMetadata | undefined,
  filters: ContentFilters,
): boolean => {
  if (!filters.allowAllContent && deriveContentRating(series) !== ContentRating.EVERYONE) {
    return false;
  }
  const tags = new Set(series.tags ?? []);
  if ([...filters.hiddenGenreIds].some((id) => tags.has(id))) return false;
  if (!matchesSingleValue(series.type, metadata?.types)) return false;
  if (!matchesSingleValue(series.status, metadata?.statuses)) return false;
  return matchesTags(tags, metadata);
};

export const hasImage = (item: DiscoverSectionItem): boolean =>
  "imageUrl" in item && item.imageUrl.length > 0;

const slugify = (text: string): string => {
  return Application.decodeHTMLEntities(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’‘"“”]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const buildSlugId = (id: number, title: string): string => {
  const slug = slugify(title);
  return slug.length > 0 ? `${id}-${slug}` : `${id}-series`;
};
export const numericSeriesId = (mangaId: string): string => {
  return mangaId.match(/^\d+/)?.[0] ?? mangaId;
};

const buildChapterId = (
  seriesId: string,
  chapterId: number | string,
  groupId?: number | string | null,
): string => `${seriesId}:${chapterId}:${groupId ?? 0}`;

export const parseChapterId = (
  value: string,
): { seriesId: string; chapterId: string; groupId: string } => {
  const [seriesId, chapterId, groupId] = value.split(":");
  if (!seriesId || !chapterId || groupId === undefined) {
    throw new Error(`Invalid Scans.GG chapter id: ${value}`);
  }
  return { seriesId, chapterId, groupId };
};
const buildCoverUrl = (cover?: string | null): string => {
  if (!cover) return "";
  if (/^https?:\/\//i.test(cover)) return cover;
  return `${CDN_URL}/covers/${cover}`;
};
const formatChapterNumber = (raw: number | string): string => {
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(n) ? String(n) : String(raw);
};

const chapterNumberValue = (raw: number | string): number => {
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
};

const parseDate = (value?: string | null): Date | undefined => {
  if (!value) return undefined;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const stripHtml = (html?: string | null): string => {
  if (!html) return "";
  return Application.decodeHTMLEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
};

const deriveContentRating = (series: Pick<SeriesDto, "tags" | "content_rating">): ContentRating => {
  const tier = series.content_rating ?? 0;
  const tags = series.tags;
  if (tier >= 4 || tags?.some((id) => ADULT_TAG_IDS.has(id))) return ContentRating.ADULT;
  if (tier >= 2 || tags?.some((id) => MATURE_TAG_IDS.has(id))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
};

const tagNames = (tags?: number[] | null): string[] => {
  return (tags ?? []).map((id) => TAGS_MAP[id]).filter((name): name is string => Boolean(name));
};

const creatorNames = (creators?: string[] | null): string | undefined => {
  const names = [...new Set((creators ?? []).map((name) => name.trim()).filter(Boolean))];
  return names.length > 0 ? Application.decodeHTMLEntities(names.join(", ")) : undefined;
};

const scanlationTeam = (chapter?: LatestChapterDto | null): string | undefined => {
  if (!chapter) return undefined;
  const names = [chapter.group?.title, ...(chapter.collab_groups ?? []).map((group) => group.title)]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name));
  const uniqueNames = [...new Set(names)];
  return uniqueNames.length > 0
    ? Application.decodeHTMLEntities(uniqueNames.join(", "))
    : undefined;
};

const formatViews = (value?: number | null): string | undefined => {
  if (value == null || !Number.isFinite(value) || value < 0) return undefined;
  return Math.trunc(value).toLocaleString("en-US");
};

const featuredInfoItems = (series: SeriesDto): FeaturedCarouselItem["infoItems"] => {
  const views = formatViews(series.popular_views ?? series.views);
  const group = scanlationTeam(series.chapters?.[0]);
  const items = [
    views ? { symbol: "eye.fill", text: views } : undefined,
    group ? { symbol: "person.2.fill", text: group } : undefined,
  ].filter((item): item is { symbol: string; text: string } => Boolean(item));
  if (items.length === 0) return undefined;
  return items as FeaturedCarouselItem["infoItems"];
};

const toPaperbackRating = (
  series: Pick<SeriesDto, "rating" | "rating_count">,
): number | undefined => {
  if (series.rating_count == null || series.rating_count <= 0) return undefined;
  if (series.rating == null || !Number.isFinite(series.rating)) return undefined;
  return Math.min(1, Math.max(0, series.rating / 5));
};

const cardSubtitle = (series: SeriesDto): string | undefined => {
  const type = series.type != null ? TYPE_NAMES[series.type] : undefined;
  if (type) return type;
  const status = mapStatus(series.status);
  return status !== "Unknown" ? status : undefined;
};

export const toSearchResultItem = (series: SeriesDto): SearchResultItem => {
  return {
    mangaId: buildSlugId(series.id, series.title),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    subtitle: cardSubtitle(series),
    contentRating: deriveContentRating(series),
  };
};

export const toFeaturedItem = (series: SeriesDto): DiscoverSectionItem => {
  return {
    type: "featuredCarouselItem",
    mangaId: buildSlugId(series.id, series.title),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    supertitle: creatorNames(series.author) ?? cardSubtitle(series),
    summary: stripHtml(series.summary) || undefined,
    infoItems: featuredInfoItems(series),
    contentRating: deriveContentRating(series),
  };
};

export const toSimpleItem = (series: SeriesDto): DiscoverSectionItem => {
  return {
    type: "simpleCarouselItem",
    mangaId: buildSlugId(series.id, series.title),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    subtitle: cardSubtitle(series),
    contentRating: deriveContentRating(series),
  };
};

export const toLatestItem = (series: SeriesDto): DiscoverSectionItem => {
  const latest = series.chapters?.[0];
  if (!latest?.id) return toSimpleItem(series);
  const chapter = latest.number != null ? `Ch. ${formatChapterNumber(latest.number)}` : undefined;
  const team = scanlationTeam(latest);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: buildSlugId(series.id, series.title),
    chapterId: buildChapterId(String(series.id), latest.id, latest.group_id),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    subtitle: [chapter, team].filter(Boolean).join(" | ") || undefined,
    publishDate: parseDate(latest.updated_at ?? latest.created_at),
    contentRating: deriveContentRating(series),
  };
};

export const parseMangaDetails = (series: SeriesDto): SourceManga => {
  const typeName = series.type != null ? TYPE_NAMES[series.type] : undefined;
  const names = [
    ...(typeName ? [typeName] : []),
    ...tagNames(series.tags),
    ...(series.themes ?? []).map((theme) => theme.trim()).filter((theme) => theme.length > 0),
  ];
  const uniqueNames = [...new Set(names)];
  const tags: Tag[] = uniqueNames.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    title: name,
  }));

  const secondaryTitles = [
    ...new Set(
      (series.alternative_titles ?? [])
        .map((alt) => (alt.title ?? "").trim())
        .filter((title) => title.length > 0),
    ),
  ];

  const author = (series.author ?? []).filter(Boolean).join(", ");
  const artist = (series.artist ?? []).filter(Boolean).join(", ");
  const slugId = buildSlugId(series.id, series.title);

  return {
    mangaId: slugId,
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(series.title),
      secondaryTitles,
      thumbnailUrl: buildCoverUrl(series.cover),
      synopsis: stripHtml(series.summary),
      author: author.length > 0 ? author : undefined,
      artist: artist.length > 0 ? artist : undefined,
      status: mapStatus(series.status),
      rating: toPaperbackRating(series),
      contentRating: deriveContentRating(series),
      tagGroups: tags.length > 0 ? [{ id: "tags", title: "Tags", tags }] : [],
      shareUrl: `${getDomain()}/series/${slugId}`,
    },
  };
};

// Some uploads pack the release as "<name> • <group>"; split off the group as
// scanlator and keep the title only when it's more than a bare "Chapter N".
const parseChapterTitle = (chapter: ChapterDto): { title?: string; group?: string } => {
  const raw = chapter.title?.trim();
  if (!raw) return {};
  const bullet = raw.indexOf("•");
  const namePart = (bullet === -1 ? raw : raw.slice(0, bullet)).trim();
  const groupPart = bullet === -1 ? "" : raw.slice(bullet + 1).trim();
  const numberOnly = /^(?:chapter|chap\.?|ch\.?|episode|ep\.?)?\s*[\d.]+$/i.test(namePart);
  return {
    title: namePart && !numberOnly ? Application.decodeHTMLEntities(namePart) : undefined,
    group: groupPart ? Application.decodeHTMLEntities(groupPart) : undefined,
  };
};

// Prefer the structured group; fall back to the group embedded in the title.
const chapterGroup = (chapter: ChapterDto): string | undefined =>
  scanlationTeam(chapter) ?? parseChapterTitle(chapter).group;

export const parseChapterList = (
  chapters: ChapterDto[],
  sourceManga: SourceManga,
  seriesSlugId: string,
): Chapter[] => {
  return chapters.map((chapter, index) => ({
    chapterId: buildChapterId(seriesSlugId, chapter.id, chapter.group_id),
    sourceManga,
    title: parseChapterTitle(chapter).title,
    version: chapterGroup(chapter) ?? "Unknown",
    chapNum: chapterNumberValue(chapter.number),
    volume: 0,
    langCode: "en",
    sortingIndex: chapters.length - index,
    publishDate: parseDate(chapter.created_at),
  }));
};

export const parseChapterPages = (data: PageListDto, chapterId: string): string[] => {
  const chapterData = data.chapter;
  const pageChapterId = chapterData?.id ?? Number(chapterId);
  const pages = [...(chapterData?.pages ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((page) => `${CDN_URL}/pages/${pageChapterId}/${page.path}`);

  if (pages.length === 0) {
    throw new Error(`No pages returned for chapter ${chapterId}.`);
  }

  return pages;
};

export const parseReaderPagePaths = (html: string): string[] => {
  const match = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) return [];

  let nodes: unknown[];
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    nodes = parsed;
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const pages: { position: number; path: string }[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const record = node as Record<string, unknown>;
    if (typeof record.position !== "number" || typeof record.path !== "number") continue;
    const position = nodes[record.position];
    const path = nodes[record.path];
    if (typeof position !== "number" || typeof path !== "string" || path.length === 0) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    pages.push({ position, path });
  }

  return pages.sort((a, b) => a.position - b.position).map((page) => page.path);
};
