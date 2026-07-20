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

import { getDomain, getShowAllVersions, isOfficialTeam } from "./models";
import type {
  CatalogItem,
  ChapterEntry,
  HomeLinkCard,
  HomeUpdate,
  ReaderChapter,
  SeriesProps,
} from "./models";

const FLIGHT_CHUNK_REGEX = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

// Pages embed their data as a streamed payload of script-pushed string
// fragments; a bare payload response (no fragments) is already the stream.
export const decodeFlightPayload = (html: string): string => {
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  FLIGHT_CHUNK_REGEX.lastIndex = 0;
  while ((match = FLIGHT_CHUNK_REGEX.exec(html)) !== null) {
    try {
      parts.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      // Fragments that fail to unescape carry no JSON of ours.
    }
  }
  return parts.length > 0 ? parts.join("") : html;
};

// String-aware balanced scan, so braces inside values don't break the depth.
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

const filterValidCatalogItems = (items: CatalogItem[] | undefined): CatalogItem[] =>
  (items ?? []).filter((item) => Boolean(item.slug) && Boolean(item.title));

export const parseCatalogItems = (html: string): CatalogItem[] =>
  filterValidCatalogItems(
    parseJsonAt(decodeFlightPayload(html), '"initialItems":[', '"initialItems":'.length),
  );

// Listing cards carry no age rating; genres are the only content signal.
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

// The front page's top strip — the first series array on the page.
export const parseHomeCarousel = (html: string): CatalogItem[] =>
  filterValidCatalogItems(
    parseJsonAt(decodeFlightPayload(html), '"items":[{"id"', '"items":'.length),
  );

// A titled homepage data row ("Popular This Week", "Most liked") by heading.
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

// Card subtitle the way the site writes it: "Manhwa 2023".
export const toHomeCarouselItem = (item: CatalogItem): DiscoverSectionItem => ({
  type: "simpleCarouselItem",
  mangaId: item.slug,
  title: item.title,
  imageUrl: item.poster,
  subtitle: [item.type, item.year ? String(item.year) : undefined].filter(Boolean).join(" "),
  contentRating: getContentRatingForGenres(item.genres),
  metadata: undefined,
});

// The payload row `<id>:[…]` a "$L<id>" placeholder points at.
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
    const window = fragment.slice(start, end);

    const cover = window.match(/"src":"(https:\/\/[^"]+)"/)?.[1];
    const alt = window.match(/"alt":"((?:[^"\\]|\\.)*)"/)?.[1];
    if (!cover || !alt) continue;

    const sub = window.match(/"hl-card-sub","children":\["((?:[^"\\]|\\.)*)"," (\d{4})"\]/);
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

// Element-rendered rows (New Season, Best Ongoings): cards are streamed inline
// or deferred as "$L<id>" placeholder rows. Walked in document order — these
// rows are rankings, so resolved placeholders must keep their position.
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
      // A placeholder row holding just a card body has no link and adds nothing.
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

// "$D2026-07-14T02:23:00.772Z" → Date (the serializer prefixes dates with $D).
const parsePayloadDate = (value?: string | null): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value.replace(/^\$D/, ""));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

// The homepage Updates feed, one card per series (its newest release).
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
  const props = parseJsonAt<SeriesProps>(decodeFlightPayload(html), '{"initialTab"');
  if (!props || !props.title) {
    throw new Error(`No series payload found for ${slug} — the page layout may have changed.`);
  }
  return props;
};

// Cover from the og:image meta — the series props carry no poster.
export const parseCoverUrl = (html: string): string =>
  html.match(/property="og:image"\s+content="([^"]+)"/)?.[1] ??
  html.match(/"og:image","content":"([^"]+)"/)?.[1] ??
  "";

const contentRatingForSeries = (props: SeriesProps): ContentRating => {
  const age = (props.ageRating ?? "").trim();
  if (age === "18+" || age === "21+") return ContentRating.ADULT;
  if (age === "15+" || age === "16+") return ContentRating.MATURE;
  // "For all"/"12+" trusts the label unless an adult genre says otherwise.
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
  // Known publisher/platform teams (Tapas, WebToon, VIZ, …) get the star.
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
    // The site tracks no real volumes — 0 avoids the "Volume TBA" placeholder.
    volume: 0,
    version,
    sortingIndex: entry.number,
    publishDate: parsePayloadDate(entry.createdAt),
  };
};

// The reader addresses uploads as `chapter/<number>?team=<slug>` (the site's
// own links), so every team's upload gets its own entry; with the all-versions
// setting off, first listed per number wins — the site's default.
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
