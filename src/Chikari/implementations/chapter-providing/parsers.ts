/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";

import type {
  ChapterDetailsResponse,
  ChapterItem,
  NovelChapterDetailsResponse,
} from "../shared/models";
import { chapterTitle, chapterToken } from "../shared/parsers";

export const parseChapters = (chapters: ChapterItem[], sourceManga: SourceManga): Chapter[] =>
  chapters.map((chapter, index) => {
    const publishDate = new Date(chapter.created_at);
    const volume = Number(chapter.volume);
    return {
      chapterId: chapterToken(chapter.number),
      sourceManga,
      langCode: chapter.lang || "en",
      chapNum: chapter.number ?? index + 1,
      title: chapterTitle(chapter),
      volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
      publishDate: Number.isNaN(publishDate.getTime()) ? undefined : publishDate,
      sortingIndex: index,
    };
  });

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

const escapeXhtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

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
  const body = content
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeXhtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");

  return {
    type: "html",
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    html: `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`,
  };
};
