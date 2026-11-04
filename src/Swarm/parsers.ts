/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  URL,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type SearchResultItem,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  DOMAIN,
  TYPE_LABELS,
  type ComicPage,
  type SwarmManga,
  type SwarmChapter,
  type Preferences,
  type PagesResponse,
} from "./models";
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
export const encodeId = (value: string): string =>
  encodeURIComponent(value).replace(
    SAFE_ID_REGEX,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
export const titleOf = (manga: SwarmManga): string =>
  Application.decodeHTMLEntities(manga.title).trim();
export const idOf = (manga: SwarmManga): string =>
  encodeId(manga.url ?? (manga.slug ? `novel/${manga.slug}` : String(manga.id)));
export const coverOf = (manga: SwarmManga): string => {
  const cover = manga.cover ?? manga.covers?.[0] ?? "";
  if (!cover) return "";
  if (cover.startsWith("https://cum.swarm.ws/"))
    return `${DOMAIN}/covers/${cover.slice("https://cum.swarm.ws/".length)}`;
  if (cover.startsWith(DOMAIN)) return cover;
  return new URL(DOMAIN).setPath("api/image-proxy").setQueryItem("url", cover).toString();
};
export const ratingFor = (manga: SwarmManga): ContentRating =>
  manga.nsfw === true ||
  (manga.genres ?? []).some((genre) => /^(adult|hentai|smut|pornographic)$/i.test(genre))
    ? ContentRating.ADULT
    : manga.suggestive === true ||
        (manga.genres ?? []).some((genre) => /^(ecchi|mature|yaoi|yuri)$/i.test(genre))
      ? ContentRating.MATURE
      : ContentRating.EVERYONE;
const languageCode = (lang: string): string =>
  ({ kr: "ko", "es-la": "es-419" })[lang.toLowerCase()] ?? lang.toLowerCase();
export const isAllowed = (manga: SwarmManga, preferences: Preferences): boolean => {
  if (
    manga.lang &&
    !preferences.languages.some((lang) => languageCode(lang) === languageCode(manga.lang!))
  )
    return false;
  if (
    manga.availableLangs?.length &&
    !manga.availableLangs.some((lang) =>
      preferences.languages.some((value) => languageCode(value) === languageCode(lang)),
    )
  )
    return false;
  const rating = ratingFor(manga);
  return (
    preferences.content === "all" ||
    (preferences.content === "adult"
      ? rating === ContentRating.ADULT
      : rating === ContentRating.EVERYONE)
  );
};
export const parseComicPage = (input: string): ComicPage => {
  let flight = input;
  if (input.trimStart().startsWith("<")) {
    const $ = cheerio.load(input);
    flight = $("script")
      .toArray()
      .map((el) => {
        const script = $(el).text();
        const start = script.indexOf("self.__next_f.push(");
        if (start < 0) return "";
        const array = JSON.parse(script.slice(start + 19, script.lastIndexOf(")"))) as [
          number,
          string,
        ];
        return typeof array[1] === "string" ? array[1] : "";
      })
      .join("");
  }
  const marker = '"initialData":';
  const start = flight.indexOf(marker);
  if (start < 0) throw new Error("Swarm did not provide this title's details and chapters.");
  const begin = flight.indexOf("{", start + marker.length);
  let depth = 0,
    inString = false,
    escaped = false;
  for (let i = begin; i < flight.length; i++) {
    const c = flight[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const data = JSON.parse(flight.slice(begin, i + 1)) as ComicPage;
      if (!data.manga?.title || !Array.isArray(data.chapters))
        throw new Error("Swarm returned incomplete title data.");
      return data;
    }
  }
  throw new Error("Swarm returned an incomplete title page. Try again.");
};
export const parseDate = (value?: string): Date | undefined => {
  if (!value || value.startsWith("0001") || value.startsWith("$")) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
export const chapterLabel = (manga: SwarmManga): string | undefined => {
  const number =
    manga.latestChapterNumber ??
    manga.latest_chapter_number ??
    manga.latestChapter ??
    manga.chapter ??
    manga.number;
  if (
    number !== undefined &&
    number !== null &&
    String(number).trim() !== "" &&
    Number.isFinite(Number(number))
  )
    return `Ch. ${Number(number)}`;
  const count = manga.chapterCount ?? manga.chapter_count ?? manga._count?.chapters;
  return count !== undefined ? `${count} Chapters` : undefined;
};
const typeName = (manga: SwarmManga): string | undefined => {
  if (manga.slug) return "Novel";
  for (const value of [
    manga.type,
    manga.demographic,
    ...(manga.genres ?? []),
    ...(manga.tags ?? []),
  ]) {
    const label = value ? TYPE_LABELS[value.trim().toLowerCase()] : undefined;
    if (label) return label;
  }
  return undefined;
};
export const toSearchItem = (manga: SwarmManga): SearchResultItem => ({
  mangaId: idOf(manga),
  title: titleOf(manga),
  imageUrl: coverOf(manga),
  contentRating: ratingFor(manga),
  subtitle: [chapterLabel(manga), typeName(manga)].filter(Boolean).join(" | ") || undefined,
});
export const parseMangaDetails = (manga: SwarmManga, id: string): SourceManga => {
  const novel = decodeURIComponent(id).startsWith("novel/");
  const type = typeName(manga);
  const groups = [
    { id: "genres", title: "Genres", values: manga.genres ?? [] },
    { id: "tags", title: "Tags", values: manga.tags ?? [] },
  ]
    .filter((group) => group.values.length)
    .map((group) => ({
      id: group.id,
      title: group.title,
      tags: [...new Set(group.values)].map((name) => ({
        id: encodeId(name),
        title: Application.decodeHTMLEntities(name),
      })),
    }));
  return {
    mangaId: id,
    mangaInfo: {
      primaryTitle: titleOf(manga),
      secondaryTitles: manga.alt_titles ?? manga.altTitles ?? [],
      thumbnailUrl: coverOf(manga),
      synopsis: manga.description ?? "",
      author: manga.authors?.length ? manga.authors.join(", ") : manga.author,
      artist: manga.artists?.length ? manga.artists.join(", ") : manga.artist,
      status: manga.status,
      contentRating: ratingFor(manga),
      contentType: novel ? "novel" : "comic",
      tagGroups: groups,
      shareUrl: new URL(DOMAIN)
        .setPath(
          `${novel ? "novel" : "comic"}/${novel ? decodeURIComponent(id).slice(6) : decodeURIComponent(id)}`,
        )
        .toString(),
      additionalInfo: {
        ...(type ? { Type: type } : {}),
        ...(manga.year ? { Year: String(manga.year) } : {}),
      },
    },
  };
};
const uploader = (chapter: SwarmChapter): string =>
  chapter.source_name?.trim() || chapter.source?.trim() || chapter.scan_group?.trim() || "swarmws";
// Numbered uploader names are repeat copies from the same origin.
const uploaderGroup = (chapter: SwarmChapter): string =>
  uploader(chapter).replace(/\d+$/, "").toLowerCase();
export const parseChapters = (
  entries: SwarmChapter[],
  sourceManga: SourceManga,
  preferences: Preferences,
): Chapter[] => {
  const novel = decodeURIComponent(sourceManga.mangaId).startsWith("novel/");
  const priority = (entry: SwarmChapter): number => {
    const index = preferences.preferred.findIndex(
      (name) => name === uploader(entry).toLowerCase() || name === uploaderGroup(entry),
    );
    return index < 0 ? preferences.preferred.length : index;
  };
  const sorted = entries
    .filter(
      (entry) =>
        novel ||
        preferences.languages.some(
          (lang) => languageCode(lang) === languageCode(entry.lang ?? "en"),
        ),
    )
    .filter(
      (entry) =>
        !preferences.blocked.some(
          (name) => name === uploader(entry).toLowerCase() || name === uploaderGroup(entry),
        ),
    )
    .slice()
    .sort((a, b) => {
      const aRank = a.rank?.toLowerCase() || "~",
        bRank = b.rank?.toLowerCase() || "~";
      return (
        Number(b.number) - Number(a.number) ||
        (preferences.chapterMode === "chapter" ? priority(a) - priority(b) : 0) ||
        (aRank < bRank ? -1 : aRank > bRank ? 1 : 0) ||
        Number(/\d+$/.exec(uploader(a))?.[0] ?? 1) - Number(/\d+$/.exec(uploader(b))?.[0] ?? 1)
      );
    });
  const seen = new Set<string>();
  const filtered = sorted.filter((entry) => {
    if (novel || preferences.chapterMode === "all") return true;
    const groupKey = `${languageCode(entry.lang ?? "en")}:${Number(entry.number)}:${preferences.chapterMode === "group" ? uploaderGroup(entry) : ""}`;
    if (seen.has(groupKey)) return false;
    seen.add(groupKey);
    return true;
  });
  return filtered.map((entry, index) => ({
    chapterId: novel ? `${entry.id}@${entry.number}` : String(entry.id),
    sourceManga,
    chapNum: Number(entry.number),
    volume: 0,
    langCode:
      entry.lang === "es-la"
        ? "es-419"
        : entry.lang === "pt-br"
          ? "pt-BR"
          : entry.lang === "kr"
            ? "ko"
            : (entry.lang ?? "en"),
    sortingIndex: filtered.length - index,
    title: entry.title?.replace(/^chapter\s+[\d.]+\s*[-:–]?\s*/i, "").trim() || undefined,
    version: novel
      ? undefined
      : [uploader(entry), entry.rank ? entry.rank.toUpperCase() : ""].filter(Boolean).join(" · "),
    publishDate: parseDate(entry.published_date ?? entry.createdAt),
  }));
};
export const parseChapterPages = (response: PagesResponse, chapter: Chapter): ChapterDetails => {
  const pages = response.chapter?.data?.filter((url) => url && !url.endsWith("/noah/fall.png"));
  if (!pages?.length)
    throw new Error(
      response.error ?? "Swarm has no readable images for this upload. Try another version.",
    );
  return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
};
export const novelXHTML = (content: string): string => {
  const fragment = /<(?:p|div|h[1-6]|ul|ol|table)\b/i.test(content)
    ? content
    : content
        .split(/\n\s*\n/)
        .filter((paragraph) => paragraph.trim())
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br/>")}</p>`)
        .join("");
  const $ = cheerio.load(fragment, { xml: { xmlMode: false, decodeEntities: true } }, false);
  $("script,style,iframe").remove();
  if (!$.root().text().trim()) throw new Error("Swarm returned an empty novel chapter.");
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${$.html({ xml: true })}</body></html>`;
};
