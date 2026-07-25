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

import { getDomain, getShowAllVersions } from "./forms/settings";
import {
  isOfficialTeam,
  type CatalogItem,
  type ChapterEntry,
  type HomeLinkCard,
  type HomeUpdate,
  type ReaderChapter,
  type SeriesProps,
  type TopSeriesCountry,
} from "./models";

export const toLinkCardSimpleItem = (card: HomeLinkCard): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: card.slug,
  title: card.title,
  imageUrl: card.cover,
  subtitle: [card.type, card.year].filter(Boolean).join(" "),
  metadata: undefined,
});

export const toLinkCardProminentItem = (
  card: HomeLinkCard,
  index: number,
): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: card.slug,
  title: card.title,
  imageUrl: card.cover,
  subtitle: `#${index + 1}`,
  metadata: undefined,
});

const FLIGHT_CHUNK_REGEX = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

export const decodeFlightPayload = (html: string): string => {
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  FLIGHT_CHUNK_REGEX.lastIndex = 0;
  while ((match = FLIGHT_CHUNK_REGEX.exec(html)) !== null) {
    try {
      parts.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {}
  }
  return parts.length > 0 ? parts.join("") : html;
};

const extractBalancedJson = (text: string, start: number): string | undefined => {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : undefined;
  if (!close) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
};

const parseJsonAt = <T>(payload: string, anchor: string, offset = 0): T | undefined => {
  const index = payload.indexOf(anchor);
  if (index < 0) return undefined;
  const blob = extractBalancedJson(payload, index + offset);
  if (!blob) return undefined;
  try {
    return JSON.parse(blob) as T;
  } catch {
    return undefined;
  }
};

const resolveFlightTextReference = (
  payload: string,
  value: string | undefined,
): string | undefined => {
  const reference = value?.match(/^\$([0-9a-f]+)$/i)?.[1];
  if (!reference) return value;

  const marker = payload.match(new RegExp(`(?:^|\\n)${reference}:T([0-9a-f]+),`, "i"));
  if (marker?.index === undefined) return value;

  const byteLength = Number.parseInt(marker[1], 16);
  const start = marker.index + marker[0].length;
  let bytes = 0;
  let resolved = "";

  for (const character of payload.slice(start)) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes =
      codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes + characterBytes > byteLength) return value;
    resolved += character;
    bytes += characterBytes;
    if (bytes === byteLength) return resolved;
  }

  return value;
};

const filterValidCatalogItems = (items: CatalogItem[] | undefined): CatalogItem[] =>
  (items ?? []).filter((item) => Boolean(item.slug) && Boolean(item.title));

export const parseCatalogItems = (items: CatalogItem[]): CatalogItem[] =>
  filterValidCatalogItems(items);

export const getContentRatingForGenres = (genres: string[] | undefined): ContentRating => {
  const lower = (genres ?? []).map((genre) => genre.toLowerCase());
  if (["hentai", "adult", "smut", "lolicon", "shotacon"].some((genre) => lower.includes(genre))) {
    return ContentRating.ADULT;
  }
  if (["ecchi", "mature", "harem"].some((genre) => lower.includes(genre))) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

export const toSearchResultItem = (item: CatalogItem): SearchResultItem => {
  const chapterCount = item._count?.chapters ?? 0;
  return {
    mangaId: item.slug,
    title: item.title,
    imageUrl: item.poster,
    contentRating: getContentRatingForGenres(item.genres),
    subtitle: chapterCount > 0 ? `${chapterCount} chapters` : (item.type ?? ""),
  };
};

export const toProminentCarouselItem = (item: CatalogItem): DiscoverSectionItem => ({
  type: "prominentCarouselItem",
  mangaId: item.slug,
  title: item.title,
  imageUrl: item.poster,
  subtitle:
    typeof item.rating === "number" && item.rating > 0
      ? `★ ${item.rating.toFixed(1)}`
      : (item.type ?? ""),
  contentRating: getContentRatingForGenres(item.genres),
  metadata: undefined,
});

export const toSimpleCarouselItem = (item: CatalogItem): DiscoverSectionItem => {
  const chapterCount = item._count?.chapters ?? 0;
  return {
    type: "simpleCarouselItem",
    mangaId: item.slug,
    title: item.title,
    imageUrl: item.poster,
    subtitle: chapterCount > 0 ? `Ch. ${chapterCount}` : (item.type ?? ""),
    contentRating: getContentRatingForGenres(item.genres),
    metadata: undefined,
  };
};

export const parseHomeSection = (html: string, title: string): CatalogItem[] => {
  const payload = decodeFlightPayload(html);
  const heading = payload.indexOf(`{"title":"${title}","moreHref"`);
  if (heading < 0) return [];
  const arrayStart = payload.indexOf('"items":[', heading);
  if (arrayStart < 0) return [];
  const blob = extractBalancedJson(payload, arrayStart + '"items":'.length);
  if (!blob) return [];
  try {
    return filterValidCatalogItems(JSON.parse(blob) as CatalogItem[]);
  } catch {
    return [];
  }
};

export const parseHomeTopSeries = (html: string, country: TopSeriesCountry): CatalogItem[] => {
  const groups = parseJsonAt<Partial<Record<TopSeriesCountry, CatalogItem[]>>>(
    decodeFlightPayload(html),
    '{"korea":[',
  );
  return filterValidCatalogItems(groups?.[country]);
};

export const toHomeCarouselItem = (item: CatalogItem): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: item.slug,
  title: item.title,
  imageUrl: item.poster,
  subtitle: [item.type, item.year ? String(item.year) : undefined].filter(Boolean).join(" "),
  contentRating: getContentRatingForGenres(item.genres),
  metadata: undefined,
});

const resolveLazyRow = (payload: string, id: string): string | undefined => {
  const marker = payload.match(new RegExp(`(?:^|\\n)${id}:`));
  if (marker?.index === undefined) return undefined;
  const start = marker.index + marker[0].length;
  if (payload[start] !== "[") return undefined;
  return extractBalancedJson(payload, start);
};

const unescapeText = (raw: string): string => {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
};

const parseLinkCards = (fragment: string): HomeLinkCard[] => {
  const cards: HomeLinkCard[] = [];
  const anchors = [...fragment.matchAll(/"href":"\/manga\/([a-z0-9-]+)"/g)];

  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].index ?? 0;
    const end =
      i + 1 < anchors.length ? (anchors[i + 1].index ?? fragment.length) : fragment.length;
    const segment = fragment.slice(start, end);

    const cover = segment.match(/"src":"(https:\/\/[^"]+)"/)?.[1];
    const alt = segment.match(/"alt":"((?:[^"\\]|\\.)*)"/)?.[1];
    if (!cover || !alt) continue;

    const sub = segment.match(/"hl-card-sub","children":\["((?:[^"\\]|\\.)*)"," (\d{4})"\]/);
    cards.push({
      slug: anchors[i][1],
      title: unescapeText(alt),
      cover,
      type: sub ? unescapeText(sub[1]) : undefined,
      year: sub?.[2],
    });
  }
  return cards;
};

export const parseHomeLinkSection = (
  html: string,
  heading: string,
  containerMarker: string,
): HomeLinkCard[] => {
  const payload = decodeFlightPayload(html);
  const headingIndex = payload.indexOf(`"children":"${heading}"`);
  if (headingIndex < 0) return [];
  const containerIndex = payload.indexOf(containerMarker, headingIndex);
  if (containerIndex < 0) return [];
  const arrayStart = payload.indexOf('"children":[', containerIndex);
  if (arrayStart < 0) return [];
  const blob = extractBalancedJson(payload, arrayStart + '"children":'.length);
  if (!blob) return [];

  const cards: HomeLinkCard[] = [];
  const tokens = [...blob.matchAll(/"href":"\/manga\/([a-z0-9-]+)"|"\$L([0-9a-f]+)"/g)];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token[1]) {
      const start = token.index ?? 0;
      const end = i + 1 < tokens.length ? (tokens[i + 1].index ?? blob.length) : blob.length;
      cards.push(...parseLinkCards(blob.slice(start, end)));
    } else {
      const row = resolveLazyRow(payload, token[2]);
      if (row) cards.push(...parseLinkCards(row));
    }
  }

  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.slug)) return false;
    seen.add(card.slug);
    return true;
  });
};

const parsePayloadDate = (value?: string | null): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value.replace(/^\$D/, ""));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export const parseHomeUpdates = (html: string): DiscoverSectionItem[] => {
  const payload = decodeFlightPayload(html);
  const updates = parseJsonAt<HomeUpdate[]>(payload, '"updates":[', '"updates":'.length) ?? [];

  const seen = new Set<string>();
  const items: DiscoverSectionItem[] = [];
  for (const update of updates) {
    const manga = update.manga;
    if (!manga?.slug || !manga.poster || typeof update.number !== "number") continue;
    if (seen.has(manga.slug)) continue;
    seen.add(manga.slug);

    items.push({
      type: "chapterUpdatesCarouselItem",
      mangaId: manga.slug,
      chapterId: String(update.number),
      title: manga.title,
      imageUrl: manga.poster,
      subtitle: `Ch. ${update.number}`,
      publishDate: parsePayloadDate(update.createdAt),
      metadata: undefined,
    });
  }
  return items;
};

export const parseSeriesProps = (html: string, slug: string): SeriesProps => {
  const payload = decodeFlightPayload(html);
  const props = parseJsonAt<SeriesProps>(payload, '{"initialTab"');
  if (!props || !props.title) {
    throw new Error(`No series payload found for ${slug} — the page layout may have changed.`);
  }
  return { ...props, description: resolveFlightTextReference(payload, props.description) };
};

export const parseCoverUrl = (html: string): string =>
  html.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ??
  html.match(/"og:image","content":"([^"]+)"/)?.[1] ??
  "";

const contentRatingForSeries = (props: SeriesProps): ContentRating => {
  const age = (props.ageRating ?? "").trim();
  if (age === "18+" || age === "21+") return ContentRating.ADULT;
  if (age === "15+" || age === "16+") return ContentRating.MATURE;
  const fromGenres = getContentRatingForGenres(props.genres);
  return fromGenres === ContentRating.ADULT ? fromGenres : ContentRating.EVERYONE;
};

const toTagSection = (id: string, title: string, names: string[]): TagSection | undefined => {
  if (names.length === 0) return undefined;
  const tags: Tag[] = names.map((name) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: name,
  }));
  return { id, title, tags };
};

export const parseMangaDetails = (html: string, mangaId: string): SourceManga => {
  const props = parseSeriesProps(html, mangaId);

  const tagGroups = [
    toTagSection("genres", "Genres", props.genres ?? []),
    toTagSection("tags", "Tags", props.tags ?? []),
  ].filter((section): section is TagSection => section !== undefined);

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl: parseCoverUrl(html),
      synopsis: props.description ?? "",
      primaryTitle: props.title,
      secondaryTitles: props.altNames ?? [],
      contentRating: contentRatingForSeries(props),
      status: props.status ?? "Unknown",
      artist: props.artist ?? "",
      author: props.author ?? "",
      tagGroups,
      shareUrl: `${getDomain()}/manga/${mangaId}`,
    },
  };
};

const toChapter = (
  entry: ChapterEntry,
  sourceManga: SourceManga,
  allVersions: boolean,
): Chapter => {
  const teamName = entry.team?.name ?? entry.translator ?? undefined;
  const version =
    teamName && isOfficialTeam(teamName, entry.team?.slug) ? `★ ${teamName}` : teamName;
  const teamSuffix =
    allVersions && entry.team?.slug ? `?team=${encodeURIComponent(entry.team.slug)}` : "";

  return {
    chapterId: `${entry.number}${teamSuffix}`,
    sourceManga,
    langCode: "en",
    chapNum: entry.number,
    title: entry.title?.trim() ?? "",
    volume: 0,
    version,
    sortingIndex: entry.number,
    publishDate: parsePayloadDate(entry.createdAt),
  };
};

export const parseChapters = (html: string, sourceManga: SourceManga): Chapter[] => {
  const props = parseSeriesProps(html, sourceManga.mangaId);
  const allVersions = getShowAllVersions();

  const seen = new Set<string>();
  const chapters: Chapter[] = [];
  for (const entry of props.chapters ?? []) {
    if (entry.isLocked === true || typeof entry.number !== "number") continue;
    const key = allVersions ? `${entry.number}|${entry.team?.slug ?? ""}` : String(entry.number);
    if (seen.has(key)) continue;
    seen.add(key);
    chapters.push(toChapter(entry, sourceManga, allVersions));
  }
  return chapters;
};

export const parseChapterDetails = (html: string, chapter: Chapter): ChapterDetails => {
  const payload = decodeFlightPayload(html);
  const reader = parseJsonAt<ReaderChapter>(payload, '"chapter":{"id":', '"chapter":'.length);

  const pages = reader?.pages && reader.pages.length > 0 ? reader.pages : (reader?.pagesAlt ?? []);
  if (pages.length === 0) {
    throw new Error(
      `No pages returned for chapter ${chapter.chapterId} of ${chapter.sourceManga.mangaId}.`,
    );
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};
