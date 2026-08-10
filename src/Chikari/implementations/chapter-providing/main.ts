/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";

import {
  fetchChapterDetails,
  fetchChapters,
  fetchNovelChapterDetails,
  fetchNovelChapters,
} from "../../services/network";
import { decodeMangaId } from "../shared/parsers";
import { parseChapterDetails, parseChapters, parseNovelChapterDetails } from "./parsers";

export class ChapterProvider {
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const { medium, slug } = decodeMangaId(sourceManga.mangaId);
    const response =
      medium === "novel" ? await fetchNovelChapters(slug) : await fetchChapters(slug);
    return parseChapters(response.items, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { medium, slug } = decodeMangaId(chapter.sourceManga.mangaId);
    return medium === "novel"
      ? parseNovelChapterDetails(await fetchNovelChapterDetails(slug, chapter.chapterId), chapter)
      : parseChapterDetails(await fetchChapterDetails(slug, chapter.chapterId), chapter);
  }
}
