/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import {
  DOMAIN,
  PORNOGRAPHIC_TAGS,
  STATUS_NAMES,
  TAG_GROUPS,
  UNLISTED_TAGS,
  type ChapterRelease,
  type ChapterResponse,
  type ContentRatingId,
  type FacetsResponse,
  type LatestResponse,
  type Series,
  type SeriesResponse,
} from "./models";
import { encodePageUrl } from "./network";
import { unwrapPageKey, type ReaderKey } from "./utils";

// A tag id is the name percent-encoded so it passes Paperback's id rules and decodes back to the
// name the browse filters expect. encodeURIComponent leaves !'*~ alone, and Paperback rejects them.
export const toTagId = (name: string): string =>
  encodeURIComponent(name).replace(
    /[!'*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const fromTagId = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

const HID_REGEX = /^[a-z][0-9a-z]{4}$/;

export const parseMangaIdFromUrl = (value: string): string | undefined => {
  const hid = value.match(/toonkotsu\.com\/title\/([a-z][0-9a-z]{4})(?:[-/?#]|$)/i)?.[1];
  return hid && HID_REGEX.test(hid) ? hid : undefined;
};

const COVER_SIZE_REGEX = /\/(?:220|460|720)\.webp$/;

const toAbsoluteUrl = (path: string): string =>
  path.startsWith("http") ? path : `${DOMAIN}${path.startsWith("/") ? "" : "/"}${path}`;

const parseCoverUrl = (cover: string | null | undefined, size: 460 | 720 = 460): string =>
  cover
    ? toAbsoluteUrl(cover).replace(COVER_SIZE_REGEX, `/${size}.webp`)
    : `${DOMAIN}/images/cover.webp`;

// The site's own rating ladder: a series flagged adult or tagged Hentai is pornographic, Smut or
// Adult is erotica, Ecchi or Mature is suggestive.
export const parseRatingId = (series: Series): ContentRatingId => {
  const tags = series.tags ?? [];
  if (series.adult || tags.includes("Hentai")) return "pornographic";
  if (tags.some((tag) => tag === "Smut" || tag === "Adult")) return "erotica";
  if (tags.some((tag) => tag === "Ecchi" || tag === "Mature")) return "suggestive";
  return "safe";
};

const toContentRating = (rating: ContentRatingId): ContentRating => {
  switch (rating) {
    case "safe":
      return ContentRating.EVERYONE;
    case "suggestive":
      return ContentRating.MATURE;
    default:
      return ContentRating.ADULT;
  }
};

const cleanText = (value: string | null | undefined): string =>
  Application.decodeHTMLEntities(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

// Scores are out of 100.
const scoreOutOfTen = (score: number | null | undefined): number | undefined =>
  score && score > 0 ? score / 10 : undefined;

const formatCount = (count: number): string =>
  count >= 1000 ? `${Number((count / 1000).toFixed(1))}K` : String(count);

const formatChapterNumber = (value: number): string => String(Number(value.toFixed(2)));

// A oneshot is numbered 0 and labelled as such, so its label reads better than "Ch. 0".
const chapterSubtitle = (series: Series): string | undefined => {
  const number = series.latest?.n;
  const label = cleanText(series.latest?.label);
  if (number === 0 && label && !/\d/.test(label)) return label;
  if (typeof number === "number") return `Ch. ${formatChapterNumber(number)}`;
  return series.chapters ? `${series.chapters} Chapters` : undefined;
};

const baseItem = (series: Series, mangaId: string) => ({
  mangaId,
  title: cleanText(series.title),
  imageUrl: parseCoverUrl(series.cover),
  contentRating: toContentRating(parseRatingId(series)),
});

const withMangaId = <T>(series: Series, build: (mangaId: string) => T): T[] =>
  series.hid && HID_REGEX.test(series.hid) ? [build(series.hid)] : [];

export const toFeaturedItems = (items: { series: Series; rank: number }[]): DiscoverSectionItem[] =>
  items.flatMap(({ series, rank }) =>
    withMangaId(series, (mangaId): DiscoverSectionItem => {
      const score = scoreOutOfTen(series.score);
      const subtitle = chapterSubtitle(series);
      const infoItems = [
        ...(score === undefined ? [] : [{ symbol: "star.fill", text: score.toFixed(1) }]),
        ...(series.count
          ? [{ symbol: "eye.fill", text: `${formatCount(series.count)} reads` }]
          : subtitle
            ? [{ symbol: "book.fill", text: subtitle }]
            : []),
      ];
      return {
        type: "featuredCarouselItem",
        ...baseItem(series, mangaId),
        supertitle: [`#${rank}`, series.type, subtitle].filter(Boolean).join(" • "),
        summary: cleanText(series.description) || undefined,
        infoItems:
          infoItems.length === 2
            ? [infoItems[0]!, infoItems[1]!]
            : infoItems.length === 1
              ? [infoItems[0]!]
              : undefined,
      };
    }),
  );

export const toCarouselItems = (
  items: Series[],
  type: "prominentCarouselItem" | "simpleCarouselItem",
): DiscoverSectionItem[] =>
  items.flatMap((series) =>
    withMangaId(series, (mangaId) => ({
      type,
      ...baseItem(series, mangaId),
      subtitle: chapterSubtitle(series),
    })),
  );

export const toSearchResults = (items: Series[]): SearchResultItem[] =>
  items.flatMap((series) =>
    withMangaId(series, (mangaId) => ({
      ...baseItem(series, mangaId),
      subtitle: chapterSubtitle(series),
    })),
  );

// A label reads "Chapter 12: Title [Group]"; the bracketed group and the bare number are not part
// of the title.
const parseLabel = (release: ChapterRelease, number?: number | null) => {
  let label = cleanText(release.label);
  const bracket = /\s*\[([^\]]+)\]\s*$/.exec(label);
  const bracketGroup = bracket?.[1]?.trim();
  if (bracket) label = label.slice(0, bracket.index).trim();
  const numbered = /^(?:[A-Za-z]+\.?)?\s*#?\s*[\d.]+\s*(?:[:\-–—.|]\s*(.*))?$/.exec(label);
  const title = (numbered ? numbered[1] : label)?.trim();
  const group = cleanText(release.group?.name) || bracketGroup;
  const bare = title?.replace(/^(?:chapter|ch\.?|episode|ep\.?)\s*#?\s*/i, "");
  const isNumber = number != null && bare !== undefined && bare !== "" && Number(bare) === number;
  return {
    title: title && !isNumber && title.toLowerCase() !== group?.toLowerCase() ? title : undefined,
    group,
  };
};

export const toLatestItems = (items: LatestResponse["items"]): DiscoverSectionItem[] =>
  items.flatMap(({ chapter, series }) =>
    withMangaId(series, (mangaId): DiscoverSectionItem => {
      const { group } = parseLabel(chapter, chapter.n);
      const number =
        typeof chapter.n === "number" ? `Ch. ${formatChapterNumber(chapter.n)}` : undefined;
      return {
        type: "chapterUpdatesCarouselItem",
        ...baseItem(series, mangaId),
        chapterId: String(chapter.id),
        subtitle: [number, group].filter(Boolean).join(" • ") || undefined,
        publishDate: chapter.at ? new Date(chapter.at) : undefined,
      };
    }),
  );

const tagGroupId = (category: string | null | undefined): string => {
  if (!category) return "genres";
  return TAG_GROUPS.find(({ prefix }) => prefix && category.startsWith(prefix))?.id ?? "themes";
};

// Hentai, Adult and Smut are offered once erotica is allowed, and tags the catalogue flags adult
// only with pornographic titles, as the site does.
export const parseTagGroups = (facets: FacetsResponse, ratings: string[]): TagSection[] => {
  const groups = new Map<string, Tag[]>();
  for (const facet of facets.genres ?? []) {
    if (UNLISTED_TAGS.has(facet.name) || facet.category === "Demographic") continue;
    if (facet.isAdult && !ratings.includes("pornographic")) continue;
    if (
      PORNOGRAPHIC_TAGS.has(facet.name) &&
      !ratings.includes("erotica") &&
      !ratings.includes("pornographic")
    ) {
      continue;
    }
    const id = tagGroupId(facet.category);
    groups.set(id, [...(groups.get(id) ?? []), { id: toTagId(facet.name), title: facet.name }]);
  }
  return TAG_GROUPS.flatMap(({ id, title }) => {
    const tags = groups.get(id)?.sort((a, b) => a.title.localeCompare(b.title)) ?? [];
    return tags.length ? [{ id, title, tags }] : [];
  });
};

const DEMOGRAPHICS = new Set(["Shounen", "Shoujo", "Seinen", "Josei"]);

export const parseMangaDetails = (
  { series }: SeriesResponse,
  mangaId: string,
  facets: FacetsResponse,
): SourceManga => {
  const primaryTitle = cleanText(series.title);
  const secondaryTitles = [
    ...new Set(
      [series.titles?.english, series.titles?.romaji, series.titles?.native, ...(series.alt ?? [])]
        .map(cleanText)
        .filter((title) => title && title !== primaryTitle),
    ),
  ];
  const spoilers = new Set(series.spoilerTags ?? []);
  const categories = new Map((facets.genres ?? []).map((facet) => [facet.name, facet.category]));
  const tags = (series.tags ?? []).filter((tag) => !UNLISTED_TAGS.has(tag) && !spoilers.has(tag));
  const demographic = (series.tags ?? []).find((tag) => DEMOGRAPHICS.has(tag));
  // Most titles have no banner but carry the wide hero image the site shows in its place.
  const banner = series.banner || series.hero;
  const authors = (series.authors ?? []).map(cleanText).filter(Boolean).join(", ");
  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: parseCoverUrl(series.cover, 720),
      bannerUrl: banner ? toAbsoluteUrl(banner) : undefined,
      synopsis: cleanText(series.description),
      contentRating: toContentRating(parseRatingId(series)),
      status: series.status ? (STATUS_NAMES[series.status] ?? series.status) : undefined,
      author: authors || undefined,
      artist: authors || undefined,
      rating: series.score ? Math.round(series.score) / 100 : undefined,
      tagGroups: [
        ...TAG_GROUPS.flatMap(({ id, title }) => {
          const groupTags = tags.filter((tag) => tagGroupId(categories.get(tag)) === id);
          return groupTags.length
            ? [{ id, title, tags: groupTags.map((tag) => ({ id: toTagId(tag), title: tag })) }]
            : [];
        }),
        ...(demographic
          ? [
              {
                id: "demographics",
                title: "Demographic",
                tags: [{ id: demographic.toLowerCase(), title: demographic }],
              },
            ]
          : []),
      ],
      shareUrl: `${DOMAIN}/title/${mangaId}${series.slug ? `-${series.slug}` : ""}`,
    },
  };
};

// Each chapter lists its main release first and alternate uploads in "alts"; every upload becomes
// its own Chapter so the app can offer them as versions. The catalogue is English only.
export const parseChapters = (
  { chapters }: SeriesResponse,
  sourceManga: SourceManga,
  languages: string[],
): Chapter[] => {
  if (!languages.includes("en")) return [];
  const releases = chapters.flatMap((entry) =>
    [entry, ...(entry.alts ?? [])].map((release) => ({ entry, release })),
  );
  return releases.map(({ entry, release }, index) => {
    const { title, group } = parseLabel(release, entry.n);
    const at = release.at ?? entry.at;
    return {
      chapterId: String(release.id),
      sourceManga,
      langCode: "en",
      chapNum: typeof entry.n === "number" ? entry.n : 0,
      title,
      version: group,
      volume: 0,
      publishDate: at ? new Date(at) : undefined,
      sortingIndex: releases.length - index,
    };
  });
};

export const parseChapterPages = async (
  response: ChapterResponse,
  readerKey: ReaderKey,
): Promise<string[]> => {
  const pages = response.chapter?.pages ?? [];
  if (!pages.length) throw new Error("This chapter has no pages.");
  return Promise.all(
    pages.map(async (page) => {
      const src = toAbsoluteUrl(page.src);
      if (!page.k || !page.n) return src;
      const key = response.wrap === "v1" ? await unwrapPageKey(readerKey, page) : page.k;
      return encodePageUrl(src, key, page.n);
    }),
  );
};
