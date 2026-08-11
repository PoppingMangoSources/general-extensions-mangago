/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  DEMOGRAPHIC_OPTIONS,
  DOMAIN,
  FORMAT_OPTIONS,
  GENRE_OPTIONS,
  TYPE_OPTIONS,
  type ChapterData,
  type ComicData,
  type ComicNode,
} from "./models";

const ADULT_GENRES = new Set(["adult", "hentai", "pornographic", "smut"]);
const MATURE_GENRES = new Set(["ecchi", "erotica", "mature", "yaoi", "yuri"]);
// Paperback rejects ids containing characters outside this set.
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;

export const toAbsoluteUrl = (url: string | null | undefined): string => {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const titleCase = (value: string): string =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const optionTitle = (id: string): string =>
  GENRE_OPTIONS.find((option) => option.id === id)?.title ??
  DEMOGRAPHIC_OPTIONS.find((option) => option.id === id)?.title ??
  FORMAT_OPTIONS.find((option) => option.id === id)?.title ??
  titleCase(id);

const contentRatingForComic = (
  rating?: string | null,
  sfw?: boolean | null,
  genres: string[] = [],
): ContentRating => {
  const normalized = genres.map((genre) => genre.trim().toLowerCase());
  if (rating === "pornographic" || normalized.some((genre) => ADULT_GENRES.has(genre))) {
    return ContentRating.ADULT;
  }
  if (
    rating === "suggestive" ||
    rating === "erotica" ||
    sfw === false ||
    normalized.some((genre) => MATURE_GENRES.has(genre))
  ) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
};

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
  type ? (TYPE_OPTIONS.find((option) => option.id === type)?.title ?? titleCase(type)) : undefined;

const baseCard = (node: ComicNode) => ({
  mangaId: node.data.id.replace(SAFE_ID_REGEX, "-"),
  title: Application.decodeHTMLEntities(node.data.name),
  imageUrl: toAbsoluteUrl(node.data.urlCover),
  contentRating: contentRatingForComic(
    node.data.contentRating,
    node.data.sfw_result,
    node.data.genres ?? [],
  ),
});

const cardSubtitle = (comic: ComicData): string | undefined =>
  [formatChapter(comic.chapterNodes_last?.[0]?.data), formatType(comic.type)]
    .filter((value): value is string => Boolean(value))
    .join(" • ") || undefined;

export const toSearchResultItem = (node: ComicNode): SearchResultItem => ({
  ...baseCard(node),
  subtitle: cardSubtitle(node.data),
});

export type CarouselItemType =
  | "featuredCarouselItem"
  | "simpleCarouselItem"
  | "chapterUpdatesCarouselItem";

export const toDiscoverItem = (
  node: ComicNode,
  type: CarouselItemType,
): DiscoverSectionItem | undefined => {
  const chapter = node.data.chapterNodes_last?.[0]?.data;
  if (type === "featuredCarouselItem") {
    const number = chapterNumber(chapter);
    return {
      type,
      ...baseCard(node),
      supertitle: formatType(node.data.type),
      summary: stripHtml(node.data.summary?.html) || undefined,
      infoItems: number != null ? [{ symbol: "book.fill", text: String(number) }] : undefined,
    };
  }
  if (type === "chapterUpdatesCarouselItem") {
    if (!chapter?.id) return undefined;
    return {
      type,
      ...baseCard(node),
      chapterId: chapter.urlPath ?? chapter.id,
      subtitle: cardSubtitle(node.data),
      publishDate: dateFromTimestamp(
        chapter.dateModify ?? chapter.dateCreate ?? chapter.datePublic,
      ),
    };
  }
  return { type, ...baseCard(node), subtitle: cardSubtitle(node.data) };
};

export const parseLatestUploads = (
  input: string,
): { items: DiscoverSectionItem[]; before?: number } => {
  const $ = cheerio.load(input);
  const cards = $("main > .space-y-5 > .space-y-5 > .grid > div");
  if (!cards.length) throw new Error("XCOMIC returned no latest uploads");

  return {
    items: cards
      .map((_, element) => {
        const card = $(element);
        const mangaAnchor = card.find('h3 a[href^="/comic/"]').first();
        const mangaPath = mangaAnchor.attr("href");
        const mangaId = /^\/comic\/([a-zA-Z0-9]+)(?:[-/]|$)/.exec(mangaPath ?? "")?.[1];
        const chapterAnchor = card
          .find('a[href^="/comic/"]')
          .filter((_, anchor) => $(anchor).attr("href")?.startsWith(`${mangaPath}/`) === true)
          .first();
        const chapterPath = chapterAnchor.attr("href");
        const chapterId = /\/([a-zA-Z0-9]+)(?:[-/]|$)/.exec(
          chapterPath?.slice(mangaPath?.length ?? 0) ?? "",
        )?.[1];
        const timestamp = Number(card.find("time[data-time]").first().attr("data-time"));
        const name = mangaAnchor.text().trim();
        const cover = card.find("img").first().attr("src")?.trim();
        if (
          !mangaId ||
          !chapterId ||
          !mangaPath ||
          !chapterPath ||
          !name ||
          !cover ||
          !Number.isFinite(timestamp)
        ) {
          return undefined;
        }

        const genres = card
          .find("h3 + div .whitespace-nowrap")
          .map((_, genre) => $(genre).text().trim())
          .get()
          .filter(Boolean);
        const type = TYPE_OPTIONS.find((option) =>
          genres.some((genre) => genre.toLowerCase() === option.title.toLowerCase()),
        )?.id;

        return toDiscoverItem(
          {
            data: {
              id: mangaId,
              name,
              urlCover: cover,
              type,
              genres,
              chapterNodes_last: [
                {
                  data: {
                    id: chapterId,
                    dname: chapterAnchor.text().trim(),
                    urlPath: chapterPath,
                    datePublic: timestamp,
                  },
                },
              ],
            },
          },
          "chapterUpdatesCarouselItem",
        );
      })
      .get()
      .filter((item): item is DiscoverSectionItem => item !== undefined),
    before:
      Number(
        $("a[href*='?before=']")
          .attr("href")
          ?.match(/[?&]before=(\d+)/)?.[1],
      ) || undefined,
  };
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

const formatDateYmd = (
  value?: {
    y?: number | null;
    m?: number | null;
    d?: number | null;
  } | null,
): string | undefined => {
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
  const genres = [...new Set([...(comic.genres ?? []), ...(comic.demographics ?? [])])];
  const tags = comic.tags ?? nodeNames(comic.tagNodes);
  const tagGroups: TagSection[] = [
    {
      id: "genres",
      title: "Genres",
      tags: genres.map((id) => ({ id, title: optionTitle(id) })),
    },
    {
      id: "tags",
      title: "Tags",
      tags: tags.map((id) => ({ id, title: titleCase(id) })),
    },
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
    mangaId: comic.id.replace(SAFE_ID_REGEX, "-"),
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(comic.name),
      secondaryTitles: (comic.altNames ?? []).map((title) => Application.decodeHTMLEntities(title)),
      thumbnailUrl: cover,
      synopsis: stripHtml(comic.summary?.html),
      author: authors.join(", ") || undefined,
      artist: distinctArtists.join(", ") || undefined,
      contentRating: contentRatingForComic(comic.contentRating, comic.sfw_result, [
        ...(comic.genres ?? []),
        ...(comic.tags ?? []),
      ]),
      rating,
      status: comic.originalStatus
        ? titleCase(comic.originalStatus)
        : comic.uploadStatus
          ? titleCase(comic.uploadStatus)
          : "Unknown",
      tagGroups,
      artworkUrls: cover ? [cover] : undefined,
      additionalInfo: {
        ...(comic.type ? { Type: formatType(comic.type) ?? comic.type } : {}),
        ...(comic.originalLanguage ? { "Original Language": comic.originalLanguage } : {}),
        ...(comic.translatedLanguage ? { "Translated Language": comic.translatedLanguage } : {}),
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
        ...(publishers.length > 0 ? { Publishers: publishers.join(", ") } : {}),
      },
      shareUrl: toAbsoluteUrl(comic.urlPath || `/comic/${comic.id}`),
    },
  };
};

export const toChapter = (data: ChapterData, sourceManga: SourceManga): Chapter => {
  const number = chapterNumber(data) ?? 0;
  const title = [data.dname?.trim(), data.title?.trim()]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => index === 0 || value !== values[0])
    .map((value) => Application.decodeHTMLEntities(value))
    .join(": ");
  const scanlators = nodeNames(data.groupNodes);
  const uploaderName = data.userNode?.data?.name?.trim();
  const uploader = uploaderName ? Application.decodeHTMLEntities(uploaderName) : undefined;
  const language = sourceManga.mangaInfo.additionalInfo?.["Translated Language"];
  const langCode =
    typeof language === "string" && language
      ? language === "_t"
        ? "und"
        : language.replaceAll("_", "-")
      : "en";

  return {
    chapterId: (data.urlPath ?? `/comic/chapter/${data.id}`).replace(SAFE_ID_REGEX, "-"),
    sourceManga,
    chapNum: number,
    volume: 0,
    title: title || undefined,
    langCode,
    publishDate: dateFromTimestamp(data.dateModify ?? data.dateCreate ?? data.datePublic),
    version: scanlators.join(", ") || uploader || undefined,
  };
};

const FLIGHT_IMAGE_REGEX =
  /\/_f\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9._-]+\.(?:webp|jpe?g|png|avif)/gi;

const parseFlightImages = (html: string): string[] => {
  const groups = new Map<string, string[]>();
  for (const path of html.match(FLIGHT_IMAGE_REGEX) ?? []) {
    const folder = path.split("/").slice(0, 4).join("/");
    const group = groups.get(folder) ?? [];
    group.push(path);
    groups.set(folder, group);
  }

  let best: string[] = [];
  for (const group of groups.values()) {
    if (group.length > best.length) best = group;
  }

  const seen = new Set<string>();
  return best.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
};

export const parseChapterDetails = (html: string, chapter: Chapter): ChapterDetails => {
  const pages = parseFlightImages(html).map(toAbsoluteUrl);
  if (!pages.length) throw new Error("XCOMIC returned no chapter images");
  return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
};
