/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";

import type { ChapterDetailsResponse, ChapterItem } from "../shared/models";
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
      volume: Number.isFinite(volume) && volume > 0 ? volume : undefined,
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
