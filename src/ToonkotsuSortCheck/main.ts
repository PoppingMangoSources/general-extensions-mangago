/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ExtensionImpl, SourceManga } from "@paperback/types";

import { ToonkotsuExtension } from "../Toonkotsu/main";
import { parseChapters } from "./parsers";
import type ToonkotsuSortCheckConfig from "./pbconfig";

class ToonkotsuSortCheckExtension
  extends ToonkotsuExtension
  implements ExtensionImpl<typeof ToonkotsuSortCheckConfig>
{
  override async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    return parseChapters(await super.getChapters(sourceManga));
  }
}

export const ToonkotsuSortCheck = new ToonkotsuSortCheckExtension();
