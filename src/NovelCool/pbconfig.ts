/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "NovelCool",
  description: "Extension that pulls content from novelcool.com.",
  version: "1.0.0-alpha.9",
  icon: "icons.png",
  language: "en",
  contentRating: ContentRating.ADULT,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
  ],
  badges: [
    { label: "Novel", textColor: "#33162a", backgroundColor: "#ffc17e" },
    { label: "Manga", textColor: "#33162a", backgroundColor: "#ffbbd5" },
  ],
  developers: [
    {
      name: "Popmango",
      github: "https://github.com/PoppingMangoSources",
    },
  ],
} satisfies ExtensionInfo;
