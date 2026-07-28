/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";

import { fetchChapterDetails, fetchChapters } from "../../services/network";
import { parseChapterDetails, parseChapters } from "./parsers";

export class ChapterProvider {
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const response = await fetchChapters(sourceManga.mangaId);
    return parseChapters(response.items, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const response = await fetchChapterDetails(chapter.sourceManga.mangaId, chapter.chapterId);
    return parseChapterDetails(response, chapter);
  }
}
