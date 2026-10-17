/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type UpdateManager,
} from "@paperback/types";

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

  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    const [first] = updateManager.getQueuedItems();
    if (!first) return;
    const { medium, slug } = decodeMangaId(first.mangaId);
    try {
      await (medium === "novel" ? fetchNovelChapters(slug) : fetchChapters(slug));
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
    }
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const { medium, slug } = decodeMangaId(chapter.sourceManga.mangaId);
    return medium === "novel"
      ? parseNovelChapterDetails(await fetchNovelChapterDetails(slug, chapter.chapterId), chapter)
      : parseChapterDetails(await fetchChapterDetails(slug, chapter.chapterId), chapter);
  }
}
