/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ExtensionImpl, SourceManga } from "@paperback/types";

import { ToonkotsuExtension } from "../Toonkotsu/main";
import type ToonkotsuSortCheckConfig from "./pbconfig";

class ToonkotsuSortCheckExtension
  extends ToonkotsuExtension
  implements ExtensionImpl<typeof ToonkotsuSortCheckConfig>
{
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters = await super.getChapters(sourceManga);
    return chapters.map((chapter) => ({
      ...chapter,
      title: [chapter.title, `Sort Check 1: index ${chapter.sortingIndex}`]
        .filter(Boolean)
        .join(" - "),
    }));
  }
}

export const ToonkotsuSortCheck = new ToonkotsuSortCheckExtension();
