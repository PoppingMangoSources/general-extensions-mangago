/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";
import * as cheerio from "cheerio";

import {
  SAFE_ID_REGEX,
  type ChapterDetailsResponse,
  type ChapterItem,
  type NovelChapterDetailsResponse,
} from "../shared/models";
import { chapterTitle, chapterToken, decodeMangaId } from "../shared/parsers";

export const parseChapters = (chapters: ChapterItem[], sourceManga: SourceManga): Chapter[] => {
  const { medium } = decodeMangaId(sourceManga.mangaId);
  return chapters.flatMap((chapter, index) => {
    const publishDate = new Date(chapter.created_at);
    const volume = Number(chapter.volume);
    const automatic: Chapter = {
      chapterId: chapterToken(chapter.number),
      sourceManga,
      langCode: chapter.lang || "en",
      chapNum: chapter.number ?? index + 1,
      title: chapterTitle(chapter),
      volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
      publishDate: Number.isNaN(publishDate.getTime()) ? undefined : publishDate,
      sortingIndex: index,
      version: medium === "comic" ? "Automatic" : undefined,
    };
    if (medium === "novel") return [automatic];
    return [
      automatic,
      ...(chapter.scans ?? []).map((scan) => {
        const scanId = encodeURIComponent(scan.slug).replace(
          SAFE_ID_REGEX,
          (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
        );
        const scanDate = new Date(scan.created_at);
        return {
          ...automatic,
          chapterId: `${automatic.chapterId}@${scanId}`,
          version: scan.name,
          publishDate: Number.isNaN(scanDate.getTime()) ? automatic.publishDate : scanDate,
        };
      }),
    ];
  });
};

export const parseChapterDetails = (
  response: ChapterDetailsResponse,
  chapter: Chapter,
): ChapterDetails => {
  if (response.pages.length === 0) {
    throw new Error(`No pages were returned for ${chapter.sourceManga.mangaInfo.primaryTitle}.`);
  }
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages: response.pages,
  };
};

export const parseNovelChapterDetails = (
  response: NovelChapterDetailsResponse,
  chapter: Chapter,
): ChapterDetails => {
  if (response.locked) {
    throw new Error(response.lock_reason || "This chapter must be unlocked on the website.");
  }

  const content = response.body.trim();
  if (!content) {
    throw new Error(`No novel content was returned for chapter ${chapter.chapterId}.`);
  }
  const paragraphs = content
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`)
    .join("");
  const $ = cheerio.load(paragraphs, null, false);
  $("script, style, iframe, form").remove();
  const body = $.html({ xml: true });

  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`,
  };
};
