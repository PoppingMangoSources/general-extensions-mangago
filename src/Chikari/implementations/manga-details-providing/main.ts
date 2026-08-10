/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SourceManga } from "@paperback/types";

import { fetchNovelDetails, fetchSeriesDetails } from "../../services/network";
import { decodeMangaId } from "../shared/parsers";
import { parseMangaDetails } from "./parsers";

export class MangaProvider {
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { medium, slug } = decodeMangaId(mangaId);
    return parseMangaDetails(
      medium === "novel" ? await fetchNovelDetails(slug) : await fetchSeriesDetails(slug),
      medium,
    );
  }
}
