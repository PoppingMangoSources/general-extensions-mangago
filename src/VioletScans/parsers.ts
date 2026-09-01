/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import {
  ADULT_GENRES,
  DOMAIN,
  LOCKED_CHAPTER_PREFIX,
  MATURE_GENRES,
  SAFE_ID_REGEX,
  type GenreOption,
  type MangaListItem,
  type MangaListKind,
  type PageMetadata,
  type ReaderPayload,
} from "./models";

const cleanText = (value: string): string =>
  Application.decodeHTMLEntities(value.replace(/\s+/g, " ").trim());

const toAbsoluteUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${DOMAIN}/${trimmed.replace(/^\/+/, "")}`;
};

const parseImageUrl = (element: cheerio.Cheerio<AnyNode>): string => {
  const image = element.is("img") ? element : element.find("img").first();
  const srcset = image.attr("data-srcset") || image.attr("srcset") || "";
  const srcsetUrl = srcset.split(",").at(-1)?.trim().split(/\s+/)[0] ?? "";
  return toAbsoluteUrl(
    image.attr("data-src") ||
      image.attr("data-lazy-src") ||
      image.attr("data-cfsrc") ||
      srcsetUrl ||
      image.attr("src") ||
      "",
  );
};

const genreIdFromTitle = (title: string): string =>
  cleanText(title)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const parseMangaId = (value: string): string =>
  (value.match(/\/comics\/([^/?#]+)/i)?.[1] ?? "").replace(SAFE_ID_REGEX, "-");

const parseChapterId = (value: string): string => {
  const path = value.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0] ?? "";
  return path.replace(/^\/+|\/+$/g, "").replace(SAFE_ID_REGEX, "-");
};

const parseRating = (value: string): number | undefined => {
  const rating = Number.parseFloat(value);
  return Number.isFinite(rating) ? rating : undefined;
};

export const contentRatingForGenres = (names: string[]): ContentRating => {
  const genres = names.map((name) => cleanText(name).toLowerCase());
  if (genres.some((genre) => ADULT_GENRES.includes(genre))) return ContentRating.ADULT;
  if (genres.some((genre) => MATURE_GENRES.includes(genre))) return ContentRating.MATURE;
  // Listing cards without genres default to EVERYONE; the source rating only signals site-wide presence.
  return ContentRating.EVERYONE;
};

const isLockedChapter = (price: number | undefined, hasLockMarker: boolean): boolean =>
  hasLockMarker || (price != null && Number.isFinite(price) && price > 0);

const sanitizeLockedIdPart = (value: string): string =>
  value.replace(SAFE_ID_REGEX, "-").replaceAll(":", "-");

const buildLockedChapterId = (
  identifier: string,
  chapterNumber: string | number,
  price: string | number,
): string =>
  `${LOCKED_CHAPTER_PREFIX}${[identifier, chapterNumber, price]
    .map((value) => sanitizeLockedIdPart(String(value)))
    .join(":")}`;

const parseCard = (card: cheerio.Cheerio<AnyNode>): MangaListItem | undefined => {
  const link = card.find("a[href*='/comics/']").first();
  const mangaId = parseMangaId(link.attr("href") ?? "");
  const title = cleanText(link.attr("title") || card.find(".tt").first().text());
  const cover = parseImageUrl(card.find(".limit img").first());
  if (!mangaId || !title || !cover) return undefined;

  const status = cleanText(card.find(".status i").first().text()) || undefined;
  const rating = parseRating(cleanText(card.find(".numscore").first().text()));
  const chapterName = cleanText(card.find(".adds .epxs").first().text()) || undefined;
  const isNovel = card.find(".novelabel").length > 0 || /\[novel\]$/i.test(title);

  return { mangaId, title, imageUrl: cover, rating, status, chapterName, isNovel };
};

type ParseMangaListOptions = {
  selector: string;
  kind?: MangaListKind;
  showLocked?: boolean;
  anchor?: Date;
};

export const parseMangaList = (
  $: cheerio.CheerioAPI,
  { selector, kind = "cards", showLocked = false, anchor }: ParseMangaListOptions,
): MangaListItem[] =>
  $(selector)
    .toArray()
    .flatMap((element) => {
      const row = $(element);
      if (kind === "featured") {
        const link = row.find("a[href*='/comics/']").first();
        const mangaId = parseMangaId(link.attr("href") ?? "");
        const image = link.find("img").first();
        const title = cleanText(image.attr("alt") ?? "");
        const imageUrl = parseImageUrl(image);
        return mangaId && title && imageUrl
          ? [{ mangaId, title, imageUrl, isNovel: /\[novel\]$/i.test(title) }]
          : [];
      }

      if (kind === "editorPicks") {
        const index = row.attr("data-index");
        const link = row.find(".violet-ep-series-title a[href*='/comics/']").first();
        const mangaId = parseMangaId(link.attr("href") ?? "");
        const title = cleanText(link.text());
        const imageUrl = parseImageUrl(
          $(`.violet-editor-picks .violet-ep-cover[data-index="${index ?? ""}"] img`).first(),
        );
        if (!mangaId || !title || !imageUrl) return [];
        const genres = row
          .find(".violet-ep-genres li")
          .toArray()
          .map((genre) => cleanText($(genre).text()))
          .filter(Boolean);
        const status = cleanText(row.find(".violet-ep-badge--status").first().text()) || undefined;
        const type = cleanText(row.find(".violet-ep-badge--type").first().text());
        return [
          {
            mangaId,
            title,
            imageUrl,
            genres,
            status,
            isNovel: type.toLowerCase() === "novel" || /\[novel\]$/i.test(title),
          },
        ];
      }

      const card = parseCard(row);
      if (!card || kind !== "chapterUpdates") return card ? [card] : [];

      for (const element of row.find(".chapter-list > a").toArray()) {
        const link = $(element);
        const chapterRow = link.find(".adds").first();
        if (chapterRow.hasClass("all")) continue;
        const parsedChapterId = parseChapterId(link.attr("href") ?? "");
        const chapterName = cleanText(chapterRow.find(".epxs").text());
        if (!parsedChapterId || !chapterName) continue;
        const isLocked = isLockedChapter(undefined, link.find(".fa-coins").length > 0);
        if (isLocked && !showLocked) continue;
        return [
          {
            ...card,
            chapterId: isLocked
              ? buildLockedChapterId(parsedChapterId, chapterNumber(chapterName) ?? chapterName, 0)
              : parsedChapterId,
            chapterName,
            publishDate: parsePublishDate(chapterRow.find(".epxdate").text(), anchor),
            isLocked,
          },
        ];
      }
      return [];
    });

export const parseHomeAnchor = ($: cheerio.CheerioAPI): Date | undefined => {
  const scripts = $("script")
    .toArray()
    .map((script) => $(script).html() ?? "")
    .join("\n");
  const epoch = Number(scripts.match(/"?serverNowMs"?\s*:\s*"?(\d{10,})"?/i)?.[1]);
  return Number.isFinite(epoch) ? new Date(epoch) : undefined;
};

const parsePublishDate = (value: string, anchor?: Date): Date | undefined => {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/\s+ago$/, "");
  if (!normalized) return undefined;
  if ((normalized === "new" || normalized === "today") && anchor) return anchor;

  const relative = normalized.match(
    /^(?:about\s+)?(?:an?\s+|one\s+|)(minute|hour|day|week|month|year)s?$/,
  );
  const numbered = normalized.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?$/);
  const unit = numbered?.[2] ?? relative?.[1];
  const amount = numbered ? Number(numbered[1]) : relative ? 1 : undefined;
  if (anchor && unit && amount != null) {
    const milliseconds = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    }[unit as "minute" | "hour" | "day" | "week" | "month" | "year"];
    return new Date(anchor.getTime() - amount * milliseconds);
  }

  const absolute = new Date(value);
  return Number.isNaN(absolute.getTime()) ? undefined : absolute;
};

const chapterNumber = (value: string): number | undefined => {
  const number = Number.parseFloat(value.match(/\d+(?:\.\d+)?/)?.[0] ?? "");
  return Number.isFinite(number) ? number : undefined;
};

export const parseChapterUpdatePageMetadata = (
  $: cheerio.CheerioAPI,
  buttonSelector: string,
  anchor?: Date,
): PageMetadata | undefined => {
  const button = $(buttonSelector).first();
  const page = Number.parseInt(button.attr("data-page") ?? "", 10);
  const initialOrganicCount = Number.parseInt(
    button.attr("data-violet-initial-organic-count") ?? "",
    10,
  );
  if (!Number.isFinite(page) || !Number.isFinite(initialOrganicCount)) return undefined;
  return {
    page,
    initialOrganicCount,
    displayedPinIds: button.attr("data-violet-displayed-pin-ids") ?? "",
    ...(anchor && { anchorTimestamp: anchor.getTime() }),
  };
};

export const parseGenreOptions = ($: cheerio.CheerioAPI): GenreOption[] =>
  $(".advancedsearch .genrez li")
    .toArray()
    .flatMap((element) => {
      const row = $(element);
      const title = cleanText(row.find("label").text());
      const value = row.find("input[name='genre[]']").attr("value")?.trim() ?? "";
      const id = genreIdFromTitle(title);
      return id && title && value ? [{ id, title, value }] : [];
    });

const detailValue = ($: cheerio.CheerioAPI, label: string): string => {
  for (const element of $(".tsinfo .imptdt").toArray()) {
    const row = $(element);
    if (cleanText(row.find("h1").text()).toLowerCase() === label.toLowerCase()) {
      return cleanText(row.find("i").first().text());
    }
  }
  return "";
};

export const parseMangaDetails = ($: cheerio.CheerioAPI, mangaId: string): SourceManga => {
  const primaryTitle = cleanText($("h1.entry-title").first().text());
  const thumbnailUrl = parseImageUrl($(".thumb[itemprop='image'] img").first());
  if (!primaryTitle || !thumbnailUrl) {
    throw new Error(`Unable to parse title details for ${mangaId}.`);
  }

  const secondaryTitles = cleanText($(".alternative .desktop-titles").first().text())
    .split("/")
    .map((title) => cleanText(title))
    .filter((title) => title && title !== primaryTitle);
  const synopsis = cleanText($(".entry-content[itemprop='description']").first().text());
  const status = detailValue($, "Status") || cleanText($(".extra-info.a .status i").first().text());
  const type = detailValue($, "Type");
  const rating = parseRating(cleanText($(".extra-info.a .numscore").first().text()));
  const bannerStyle = $(".bigbanner").first().attr("style") ?? "";
  const bannerUrl = toAbsoluteUrl(bannerStyle.match(/url\((?:['"]?)(.*?)(?:['"]?)\)/i)?.[1] ?? "");

  const tags: Tag[] = $(".mgen a")
    .toArray()
    .flatMap((element) => {
      const title = cleanText($(element).text());
      const id = genreIdFromTitle(title);
      return id && title ? [{ id, title }] : [];
    });
  const isNovel = type.toLowerCase() === "novel" || /\[novel\]$/i.test(primaryTitle);

  return {
    mangaId,
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl,
      synopsis,
      contentRating: contentRatingForGenres(tags.map((tag) => tag.title)),
      ...(isNovel && { contentType: "novel" as const }),
      ...(status && { status }),
      ...(rating != null && { rating: Math.min(Math.max(rating / 10, 0), 1) }),
      ...(bannerUrl && { bannerUrl }),
      ...(tags.length > 0 && { tagGroups: [{ id: "genres", title: "Genres", tags }] }),
      shareUrl: `${DOMAIN}/comics/${mangaId}/`,
    },
  };
};

export const parseChapters = (
  $: cheerio.CheerioAPI,
  sourceManga: SourceManga,
  showLocked: boolean,
): Chapter[] => {
  const rows = $("#chapterlist > ul > li").toArray();
  const chapters = rows.flatMap((element, index): Chapter[] => {
    const row = $(element);
    const link = row.find("a").first();
    const rawTitle = cleanText(row.find(".chapternum").text());
    const rawNumber = row.attr("data-num") || rawTitle;
    const chapNum = chapterNumber(rawNumber) ?? rows.length - index;
    const parsedPrice = Number.parseFloat(link.attr("data-coin") ?? "");
    const price = Number.isFinite(parsedPrice) ? parsedPrice : undefined;
    const locked = isLockedChapter(price, row.find(".text-gold").length > 0);
    if (locked && !showLocked) return [];

    const id = locked
      ? buildLockedChapterId(link.attr("data-id") || rawNumber, chapNum, price ?? 0)
      : parseChapterId(link.attr("href") ?? "");
    if (!id) return [];

    const title = locked ? "(LOCKED)" : undefined;
    const publishDate = parsePublishDate(row.find(".chapterdate").text());

    return [
      {
        chapterId: id,
        sourceManga,
        langCode: "en",
        chapNum,
        ...(title && { title }),
        ...(sourceManga.mangaInfo.contentType === "novel" && { version: "Novel" }),
        volume: 0,
        sortingIndex: rows.length - index,
        ...(publishDate && { publishDate }),
      },
    ];
  });

  if (chapters.length === 0) {
    throw new Error(`No readable chapters were found for ${sourceManga.mangaInfo.primaryTitle}.`);
  }
  return chapters;
};

export const parseLockedChapter = (
  chapterId: string,
): { chapterNumber: string; price: string } | undefined => {
  if (!chapterId.startsWith(LOCKED_CHAPTER_PREFIX)) return undefined;
  const parts = chapterId.slice(LOCKED_CHAPTER_PREFIX.length).split(":");
  return { chapterNumber: parts[1] ?? "", price: parts[2] ?? "" };
};

const isReaderPayload = (value: unknown): value is ReaderPayload => {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  if (payload.protected != null && typeof payload.protected !== "boolean") return false;
  if (payload.is_novel != null && typeof payload.is_novel !== "boolean") return false;
  return (
    payload.sources == null ||
    (Array.isArray(payload.sources) &&
      payload.sources.every(
        (source) =>
          typeof source === "object" &&
          source !== null &&
          (!("images" in source) ||
            (Array.isArray(source.images) &&
              source.images.every((image: unknown) => typeof image === "string"))),
      ))
  );
};

const extractReaderPayload = (script: string, start: number): string | undefined => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let payloadStart = -1;
  for (let index = start; index < script.length; index++) {
    const character = script[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) payloadStart = index;
      depth++;
    } else if (character === "}" && depth > 0) {
      depth--;
      if (depth === 0 && payloadStart >= 0) return script.slice(payloadStart, index + 1);
    } else if (payloadStart < 0 && !/\s/.test(character)) {
      return undefined;
    }
  }
  return undefined;
};

const parseReaderPayload = ($: cheerio.CheerioAPI): ReaderPayload | undefined => {
  for (const element of $("script").toArray()) {
    const script = $(element).html() ?? "";
    const start = script.indexOf("ts_reader.run(");
    if (start < 0) continue;
    const payload = extractReaderPayload(script, start + "ts_reader.run(".length);
    if (!payload) continue;
    try {
      const value: unknown = JSON.parse(payload);
      if (!isReaderPayload(value))
        throw new Error("The chapter reader payload has an invalid shape.");
      return value;
    } catch (error: unknown) {
      throw new Error("Unable to parse the chapter reader payload.", { cause: error });
    }
  }
  return undefined;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const parseChapterDetails = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  const payload = parseReaderPayload($);
  if (payload?.protected || $(".lock-container, .lock-card").length > 0) {
    throw new Error(`Chapter ${chapter.chapNum} is locked.`);
  }

  if (payload?.is_novel || chapter.sourceManga.mangaInfo.contentType === "novel") {
    const prose = $("#readerarea")
      .first()
      .html()
      ?.replaceAll("&nbsp;", " ")
      .replaceAll("\u00a0", " ");
    if (!prose?.trim()) {
      throw new Error(`No novel content was found for chapter ${chapter.chapNum}.`);
    }
    const heading =
      cleanText($(".headpost h1.entry-title").first().text()) || `Chapter ${chapter.chapNum}`;
    const body = cheerio
      .load(`<h2>${escapeHtml(heading)}</h2>${prose}`, null, false)
      .html({ xml: true });
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`,
    };
  }

  const pages = payload?.sources?.find((source) => source.images?.length)?.images ?? [];
  const resolvedPages = pages.map(toAbsoluteUrl).filter(Boolean);
  if (resolvedPages.length === 0) {
    throw new Error(`No pages were found for chapter ${chapter.chapNum}.`);
  }
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages: resolvedPages,
  };
};

export const hasNextPage = ($: cheerio.CheerioAPI): boolean => $(".hpage a.r").length > 0;
