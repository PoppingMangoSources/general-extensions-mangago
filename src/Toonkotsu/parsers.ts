/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  URL,
  type Chapter,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import {
  CONTENT_TAGS,
  DOMAIN,
  FORMAT_TAGS,
  PORNOGRAPHIC_TAGS,
  STATUS_NAMES,
  TAG_GROUPS,
  THEME_TAGS,
  UNLISTED_TAGS,
  type ChapterRelease,
  type ChapterEntry,
  type ContentRatingId,
  type FacetsResponse,
  type LatestResponse,
  type ReaderKeyResponse,
  type Series,
  type SeriesResponse,
} from "./models";
import { encodePageUrl } from "./network";
import { decodeBase64Url, unwrapPageKey, type ReaderKey } from "./utils";

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
  const hid = value.match(
    /^(?:https?:\/\/)?toonkotsu\.com\/title\/([a-z][0-9a-z]{4})(?:[-/?#]|$)/i,
  )?.[1];
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

const tagGroupId = (name: string, category: string | null | undefined): string => {
  if (category || THEME_TAGS.has(name)) return "themes";
  if (CONTENT_TAGS.has(name)) return "content";
  return FORMAT_TAGS.has(name) ? "format" : "genres";
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
    const id = tagGroupId(facet.name, facet.category);
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
          const groupTags = tags.filter((tag) => tagGroupId(tag, categories.get(tag)) === id);
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

const parseChapterNumber = (value: string | number | null | undefined): number | undefined => {
  if (value == null || String(value).trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const decimalPlaces = (value: number): number => {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Math.max(0, (mantissa?.split(".")[1]?.length ?? 0) - Number(exponent));
};

// Paperback groups versions by chapter number, even when the volumes differ.
const separateChapterNumbers = (chapters: Chapter[]): Chapter[] => {
  if (!chapters.length) return chapters;
  const knownVolumes = [...new Set(chapters.flatMap(({ volume }) => volume ?? []))];
  const unassignedVolume = Math.floor(Math.max(0, ...knownVolumes)) + 1;
  const volumes = [...knownVolumes, unassignedVolume];
  const offset = Math.min(0, ...volumes);
  // Scale fractional volumes together so each volume has a distinct integer suffix.
  const scale = 10 ** Math.max(...volumes.map(decimalPlaces));
  const volumesByNumber = new Map<number, Set<number>>();
  for (const chapter of chapters) {
    const values = volumesByNumber.get(chapter.chapNum) ?? new Set<number>();
    values.add(chapter.volume ?? unassignedVolume);
    volumesByNumber.set(chapter.chapNum, values);
  }
  const lowestVolumes = new Map(
    [...volumesByNumber].map(([number, values]) => [number, Math.min(...values)]),
  );
  let width = Math.max(3, String(Math.round((Math.max(...volumes) - offset) * scale)).length);
  for (;;) {
    const occupied = new Map<number, string>();
    const parsed: Chapter[] = [];
    let collision = false;
    for (const chapter of chapters) {
      const volume = chapter.volume ?? unassignedVolume;
      const key = JSON.stringify([volume, chapter.chapNum]);
      let number = chapter.chapNum;
      if (volume !== lowestVolumes.get(chapter.chapNum)) {
        const original = number.toFixed(decimalPlaces(number));
        const suffix = String(Math.round((volume - offset) * scale)).padStart(width, "0");
        number = Number(`${original}${original.includes(".") ? "" : "."}${suffix}`);
        if (!Number.isFinite(number) || number === chapter.chapNum) {
          throw new Error("Cannot separate these chapter numbers without losing precision.");
        }
      }
      const previous = occupied.get(number);
      if (previous !== undefined && previous !== key) {
        collision = true;
        break;
      }
      occupied.set(number, key);
      parsed.push({ ...chapter, chapNum: number });
    }
    if (!collision) {
      return parsed;
    }
    // A real fractional chapter may already use the proposed suffix; try a longer one.
    width++;
  }
};

const parseChapterSeason = (entry: ChapterEntry): number | undefined => {
  const match = /^\s*\[?\s*(?:s|season)\s*(\d{1,3})\s*\]?\s*(?=[-:·–—|]|\s|$)/i.exec(
    entry.label ?? "",
  );
  return match ? Number(match[1]) : undefined;
};

// The site separates volumes/seasons when at least three chapter numbers occur in multiple ones.
const hasChapterNumberResets = (
  entries: ChapterEntry[],
  section: (entry: ChapterEntry) => number | undefined,
): boolean => {
  const sections = new Map<number, Set<number>>();
  for (const entry of entries) {
    const number = parseChapterNumber(entry.n);
    const value = section(entry);
    if (number === undefined || value === undefined) continue;
    const values = sections.get(number) ?? new Set<number>();
    values.add(value);
    sections.set(number, values);
  }
  return [...sections.values()].filter((values) => values.size > 1).length >= 3;
};

// The download as the site quotes it: whole megabytes from 100 up, one decimal below.
const sizeLabel = (mb: number | null | undefined): string | undefined =>
  mb && mb > 0 ? `${Number(mb.toFixed(mb >= 100 ? 0 : 1))} MB` : undefined;

// Keep a group's best upload of each chapter, its widest and then largest, as the site's chapter
// list does. With mainOnly only the upload the site lists first is kept; with showSize a group's
// uploads of different sizes stay apart, each with its size in the title.
export const parseChapters = (
  { chapters }: SeriesResponse,
  sourceManga: SourceManga,
  { mainOnly, showSize }: { mainOnly: boolean; showSize: boolean },
): Chapter[] => {
  const releases = chapters.flatMap((entry, position) =>
    (mainOnly ? [entry] : [entry, ...(entry.alts ?? [])]).map((release, index) => ({
      ...release,
      n: entry.n,
      vol: entry.vol,
      label: release.label ?? entry.label,
      at: release.at ?? entry.at,
      canonicalId: entry.id,
      catalogueDefault: index === 0,
      position,
    })),
  );
  const byVolume = hasChapterNumberResets(releases, (entry) => parseChapterNumber(entry.vol));
  const bySeason = hasChapterNumberResets(releases, parseChapterSeason);
  const chapterKey = (release: (typeof releases)[number]): string =>
    JSON.stringify([
      byVolume
        ? (parseChapterNumber(release.vol) ?? release.vol?.toString().trim().toLowerCase())
        : "",
      bySeason ? (parseChapterSeason(release) ?? 1) : "",
      parseChapterNumber(release.n) ?? `id:${release.canonicalId}`,
    ]);
  const selected = new Map<string, { release: (typeof releases)[number]; order: number }>();
  // Prefer complete uploads, then the widest and largest, then catalogue defaults, position and ID.
  const compareReleases = (a: (typeof releases)[number], b: (typeof releases)[number]): number =>
    Number(!!a.partial) - Number(!!b.partial) ||
    (b.w ?? 0) - (a.w ?? 0) ||
    (b.mb ?? 0) - (a.mb ?? 0) ||
    Number(b.catalogueDefault) - Number(a.catalogueDefault) ||
    a.position - b.position ||
    a.id - b.id;
  const complete = new Set(releases.filter((release) => !release.partial).map(chapterKey));
  for (const release of releases) {
    const key = chapterKey(release);
    if (release.partial && complete.has(key)) continue;
    const { group } = parseLabel(release, release.n);
    const groupKey = JSON.stringify([
      key,
      release.group?.slug ?? group?.toLowerCase() ?? "",
      showSize ? (sizeLabel(release.mb) ?? "") : "",
    ]);
    const current = selected.get(groupKey);
    if (!current || compareReleases(release, current.release) < 0) {
      selected.set(groupKey, { release, order: current?.order ?? selected.size });
    }
  }
  const ordered = [...selected.values()].sort(
    ({ release: a, order: aOrder }, { release: b, order: bOrder }) => {
      if (bySeason) {
        const season = (parseChapterSeason(b) ?? 1) - (parseChapterSeason(a) ?? 1);
        if (season) return season;
      }
      // Unassigned volumes are newest; a whole-volume upload heads its volume.
      return (
        (parseChapterNumber(b.vol) ?? Infinity) - (parseChapterNumber(a.vol) ?? Infinity) ||
        (parseChapterNumber(b.n) ?? Infinity) - (parseChapterNumber(a.n) ?? Infinity) ||
        a.position - b.position ||
        aOrder - bOrder
      );
    },
  );
  const hasVolumeData = ordered.some(
    ({ release }) => parseChapterNumber(release.vol) !== undefined,
  );
  const parsed: Chapter[] = [];
  let sortingIndex = 0;
  for (const { release } of ordered) {
    const { title, group } = parseLabel(release, release.n);
    const number = parseChapterNumber(release.n);
    const volume = parseChapterNumber(release.vol);
    const size = showSize ? sizeLabel(release.mb) : undefined;
    // Keep the site's volume-first order when Paperback sorts the chapter groups.
    sortingIndex--;
    parsed.push({
      chapterId: String(release.id),
      sourceManga,
      langCode: "en",
      chapNum: number ?? 0,
      title: title && size ? `${title} (${size})` : (title ?? size),
      version: group,
      // Zero means no volume data; undefined means an unassigned volume in a numbered series.
      volume: volume ?? (hasVolumeData ? undefined : 0),
      publishDate: release.at ? new Date(release.at) : undefined,
      sortingIndex,
    });
  }
  return separateChapterNumbers(parsed);
};

export const parseReaderKeyResponse = (value: unknown): ReaderKeyResponse => {
  if (
    !value ||
    typeof value !== "object" ||
    !("key" in value) ||
    typeof value.key !== "string" ||
    !("build" in value) ||
    typeof value.build !== "string" ||
    !value.build.trim() ||
    !("now" in value) ||
    typeof value.now !== "number" ||
    !Number.isFinite(value.now) ||
    value.now <= 0
  ) {
    throw new Error(
      "Toonkotsu returned invalid reader session data. The source may need an update.",
    );
  }
  try {
    decodeBase64Url(value.key);
  } catch (error) {
    throw new Error("Toonkotsu returned an invalid reader signing key.", { cause: error });
  }
  return { key: value.key, build: value.build, now: value.now };
};

// A "v1" wrap masks the page keys, which only a signed read can unmask.
export const hasWrappedKeys = (response: unknown): boolean =>
  !!response &&
  typeof response === "object" &&
  "wrap" in response &&
  response.wrap != null &&
  response.wrap !== "";

export const parseChapterPages = async (
  response: unknown,
  readerKey?: ReaderKey,
): Promise<string[]> => {
  if (
    !response ||
    typeof response !== "object" ||
    !("chapter" in response) ||
    !response.chapter ||
    typeof response.chapter !== "object" ||
    !("pages" in response.chapter) ||
    !Array.isArray(response.chapter.pages)
  ) {
    throw new Error("Toonkotsu returned invalid chapter page data. The source may need an update.");
  }
  const wrap = "wrap" in response ? response.wrap : undefined;
  if (wrap != null && wrap !== "" && wrap !== "v1") {
    throw new Error("Unsupported Toonkotsu reader encryption version. Please update the source.");
  }
  if (wrap === "v1" && !readerKey) throw new Error("Toonkotsu masked this chapter's page keys.");
  const pages: unknown[] = response.chapter.pages;
  if (!pages.length) throw new Error("This chapter has no pages.");
  return Promise.all(
    pages.map(async (page, index) => {
      if (
        !page ||
        typeof page !== "object" ||
        !("src" in page) ||
        typeof page.src !== "string" ||
        !page.src.trim()
      ) {
        throw new Error(`Toonkotsu page ${index + 1} has no valid image URL.`);
      }
      const path = page.src.trim();
      if (/\s/.test(path) || (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^https?:\/\//i.test(path))) {
        throw new Error(`Toonkotsu page ${index + 1} has an invalid image URL.`);
      }
      const src = path.startsWith("//")
        ? `https:${path}`
        : /^https?:\/\//i.test(path)
          ? path
          : toAbsoluteUrl(path);
      try {
        const url = new URL(src);
        if (!url.hostname || !["http", "https"].includes(url.protocol.toLowerCase())) {
          throw new Error("Expected an HTTP image URL.");
        }
      } catch (error) {
        throw new Error(`Toonkotsu page ${index + 1} has an invalid image URL.`, { cause: error });
      }
      const key = "k" in page ? page.k : undefined;
      const nonce = "n" in page ? page.n : undefined;
      if (key == null && nonce == null) return src;
      if (typeof key !== "string" || typeof nonce !== "string") {
        throw new Error(`Toonkotsu page ${index + 1} has incomplete encryption metadata.`);
      }
      try {
        const keyBytes = decodeBase64Url(key);
        if (![16, 24, 32].includes(keyBytes.length)) {
          throw new Error(`Unsupported AES key length (${keyBytes.length} bytes).`);
        }
        if (decodeBase64Url(nonce).length < 8) throw new Error("The AES-CTR nonce is too short.");
        const pageKey =
          wrap === "v1" && readerKey
            ? await unwrapPageKey(readerKey, { src, k: key, n: nonce })
            : key;
        return encodePageUrl(src, pageKey, nonce);
      } catch (error) {
        throw new Error(
          `Toonkotsu page ${index + 1}: ${error instanceof Error ? error.message : "Invalid encryption metadata."} The source may need an update.`,
          { cause: error },
        );
      }
    }),
  );
};
