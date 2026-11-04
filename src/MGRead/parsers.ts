/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  URL,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

import { formatListingSubtitle } from "../utils/listings";
import {
  DOMAIN,
  type MangaListItem,
  type ChapterRecord,
  type ReaderProtection,
  type SearchItem,
} from "./models";
const SAFE_ID_REGEX = /[^a-zA-Z0-9._\-@()[\]%?#+=/&:]/g;
export const encodeId = (value: string): string =>
  encodeURIComponent(value).replace(
    SAFE_ID_REGEX,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const text = (value: string): string =>
  Application.decodeHTMLEntities(value).replace(/\s+/g, " ").trim();
export const ratingFor = (genres: string[], age = ""): ContentRating =>
  age === "18+" || genres.some((g) => /^(adult|hentai|smut)$/i.test(g))
    ? ContentRating.ADULT
    : age === "16+" || genres.some((g) => /^(ecchi|mature|yaoi|yuri)$/i.test(g))
      ? ContentRating.MATURE
      : ContentRating.EVERYONE;
const imageUrl = (image: cheerio.Cheerio<AnyNode>): string => {
  const raw = [image.attr("data-original-src"), image.attr("data-src"), image.attr("src")].find(
    (url) => url && !url.startsWith("data:"),
  );
  return raw
    ? new URL(
        raw.startsWith("//") ? `https:${raw}` : raw.startsWith("/") ? `${DOMAIN}${raw}` : raw,
      ).toString()
    : "";
};
export const pathId = (href: string): string =>
  encodeId(
    new URL(href.startsWith("/") ? `${DOMAIN}${href}` : href).path.replace(/^\/manga\/|\/+$/g, ""),
  );
export const parseMangaList = ($: cheerio.CheerioAPI): MangaListItem[] =>
  $(".manga-item-grid, .manga-item-details, .manga-card, .manga-item-ranking")
    .toArray()
    .filter((element) => $(element).closest("aside").length === 0)
    .flatMap((element) => {
      const card = $(element),
        link = card.find("h2 a, h3 a").first(),
        href = link.attr("href"),
        title = text(link.text());
      if (!href || !title || /\/manga\/anime-/.test(href)) return [];
      const chapterLink = card.find('a[href*="/chapter-"]').first();
      const number = Number.parseFloat(
        /chapter-([\d.]+)/i.exec(chapterLink.attr("href") ?? "")?.[1] ?? "",
      );
      const dateText =
        chapterLink.find("time").attr("datetime") ??
        chapterLink.find(".badge-new").attr("uk-tooltip") ??
        text(chapterLink.find("small").text());
      const date = parseDate(dateText);
      const genres = card
        .find('a[href*="/genre/"]')
        .map((_, el) => text($(el).text()))
        .get();
      const age = text(card.find("[class*=age], [class*=adult]").text());
      const count = /([\d,]+) Chapters/i.exec(card.text())?.[1];
      return [
        {
          id: pathId(href),
          title,
          cover: imageUrl(card.find("img").first()),
          genres,
          rating:
            Number.parseFloat(
              card.find('.manga-stats-bar [uk-icon*="star"]').first().parent().text(),
            ) || undefined,
          views:
            text(card.find('.manga-stats-bar [uk-icon*="eye"]').first().parent().text()) ||
            text(card.find(".init-plugin-suite-view-count-number").first().text()) ||
            text(card.find('[uk-icon*="eye"]').first().next("span").text()) ||
            undefined,
          follows:
            text(card.find('.manga-stats-bar [uk-icon*="bookmark"]').first().parent().text()) ||
            undefined,
          chapterCount: count ? Number(count.replaceAll(",", "")) : undefined,
          summary: text(card.find("div.max-2-line").first().text()) || undefined,
          ...(chapterLink.attr("href")
            ? {
                latest: {
                  id: pathId(chapterLink.attr("href")!),
                  ...(Number.isFinite(number) ? { number } : {}),
                  ...(date ? { date } : {}),
                },
              }
            : {}),
          contentRating: ratingFor(genres, age),
        },
      ];
    });
export const parseDate = (value: string): Date | undefined => {
  if (!value) return undefined;
  const relative = /^(\d+)\s*(minute|hour|day|week|month|year)s?(?: ago)?$/i.exec(value.trim());
  if (relative) {
    const scales: Record<string, number> = {
      minute: 60,
      hour: 3600,
      day: 86400,
      week: 604800,
      month: 2592000,
      year: 31536000,
    };
    return new Date(Date.now() - Number(relative[1]) * scales[relative[2].toLowerCase()] * 1000);
  }
  const absolute = new Date(value);
  return Number.isNaN(absolute.getTime()) ? undefined : absolute;
};
export const hasNextPage = ($: cheerio.CheerioAPI): boolean =>
  $("ul.uk-pagination li:not(.uk-disabled) a:has([uk-pagination-next]), a.next.page-numbers")
    .length > 0;
export const parseGenres = ($: cheerio.CheerioAPI): Tag[] =>
  $('input[name="genre[]"][data-genre-name]')
    .toArray()
    .flatMap((el) => {
      const id = $(el).attr("value"),
        title = $(el).attr("data-genre-name");
      return id && title && id !== "anime" ? [{ id: encodeId(id), title: text(title) }] : [];
    });
export const parseMangaDetails = ($: cheerio.CheerioAPI, id: string): SourceManga => {
  const title = text($("#manga-title").text());
  if (!title) throw new Error("MGRead could not find this title.");
  const genres = $("#genre-tags a:not(.uk-disabled)")
    .toArray()
    .map((el) => ({
      id: encodeId(($(el).attr("href") ?? "").replace(/\/+$/, "").split("/").pop() ?? ""),
      title: text($(el).text()),
    }));
  const share = $("[data-im-share-card]").first().attr("data-im-share-card");
  const data = share ? (JSON.parse(share) as { type?: string }) : undefined;
  return {
    mangaId: id,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: text($("#comic-othername").text()).split(";").map(text).filter(Boolean),
      thumbnailUrl:
        $("meta[property='og:image']").attr("content") ?? imageUrl($(".story-cover img").first()),
      synopsis: $("#manga-description").text().trim(),
      status: text($("#manga-status").text()) || undefined,
      contentRating: ratingFor(genres.map((g) => g.title)),
      rating: Number.parseFloat($(".init-review-info strong").first().text()) / 5 || undefined,
      ...(data?.type === "novel" ? { contentType: "novel" } : {}),
      tagGroups: genres.length ? [{ id: "genres", title: "Genres", tags: genres }] : [],
      shareUrl: new URL(DOMAIN).setPath(`manga/${decodeURIComponent(id)}/`).toString(),
    },
  };
};
export const isLocked = (chapter: ChapterRecord): boolean =>
  chapter.lock_type !== "none" && !chapter.is_purchased;
export const parseChapters = (entries: ChapterRecord[], sourceManga: SourceManga): Chapter[] =>
  entries.map((entry, index) => ({
    chapterId: encodeId(`${decodeURIComponent(sourceManga.mangaId)}/${entry.slug}`),
    sourceManga,
    langCode: "en",
    chapNum: entry.number,
    volume: 0,
    sortingIndex: entries.length - index,
    title:
      [
        isLocked(entry) ? "Locked" : "",
        text(entry.title).replace(/^chapter\s+[\d.]+\s*[-:–]?\s*/i, ""),
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    publishDate: parseDate(
      entry.created_at.includes("T")
        ? entry.created_at
        : entry.created_at.replace(" ", "T") + "+07:00",
    ),
  }));
export const parseReaderProtection = ($: cheerio.CheerioAPI): ReaderProtection | undefined => {
  const script = $("script")
    .map((_, el) => {
      const src = $(el).attr("src") ?? "";
      if (src.startsWith("data:") && src.includes(";base64,")) {
        const d = Application.base64Decode(src.split(";base64,")[1]);
        return typeof d === "string" ? d : Application.arrayBufferToUTF8String(d);
      }
      return $(el).text();
    })
    .get()
    .join("\n");
  const encrypted = /(?:var\s+)?InitMangaEncryptedChapter\s*=\s*(\{[^;]+\});/.exec(script)?.[1];
  if (!encrypted) return undefined;
  const config = /(?:var\s+)?InitMangaData\s*=\s*(\{[\s\S]+?\});/.exec(script)?.[1];
  if (!config) throw new Error("The site omitted its protected-reader configuration.");
  return {
    encrypted: JSON.parse(encrypted) as ReaderProtection["encrypted"],
    config: JSON.parse(config) as ReaderProtection["config"],
  };
};
export const parseChapterPages = ($: cheerio.CheerioAPI, chapter: Chapter): ChapterDetails => {
  if ($(".lock-card").length)
    throw new Error("This chapter is locked. Unlock it on the website before reading.");
  const pages = $("#chapter-content img, #chapter-content canvas[data-enc]")
    .toArray()
    .map((el) => {
      const encoded = $(el).attr("data-enc");
      if (!encoded) return imageUrl($(el));
      const decoded = Application.base64Decode(encoded);
      return typeof decoded === "string"
        ? decoded.split("").reverse().join("")
        : Application.arrayBufferToUTF8String(
            Uint8Array.from(new Uint8Array(decoded)).reverse().buffer,
          );
    })
    .filter(Boolean);
  if (pages.length) return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  const body = $("#chapter-content");
  body.find("script,style,iframe").remove();
  if (body.find("p").length && body.text().trim()) {
    const fragment = cheerio.load(
      body.html() ?? "",
      { xml: { xmlMode: false, decodeEntities: true } },
      false,
    );
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      type: "html",
      html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${fragment.html({ xml: true })}</body></html>`,
    };
  }
  throw new Error("MGRead returned no readable pages for this chapter.");
};
export const parseSearchItems = (items: SearchItem[]): MangaListItem[] =>
  items
    .filter((item) => item.post_type === "manga" && !item.url.includes("/anime-"))
    .map((item) => ({
      id: pathId(item.url),
      title: text(cheerio.load(item.title).text()),
      cover: item.thumbnail ?? item.thumb ?? item.image ?? "",
      genres: [],
      ...(item.type ? { type: item.type } : {}),
      contentRating: ContentRating.EVERYONE,
    }));

export const listingSubtitle = (item: MangaListItem): string | undefined =>
  formatListingSubtitle({
    chapter: item.latest?.number,
    chapterCount: item.chapterCount,
    type: item.type,
    rating: item.rating,
    views: item.views,
    follows: item.follows,
  });
