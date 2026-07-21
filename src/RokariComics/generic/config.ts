/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  SourceIntents,
  type ExtensionInfo,
  type SourceDeveloper,
} from "@paperback/types";

const BASE_VERSION = "1.0.0-alpha.6";

export const basePbConfig = {
  name: "",
  description: "",
  version: BASE_VERSION,
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.EVERYONE as ContentRating,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "PoppingMango",
      github: "https://github.com/PoppingMango",
    },
  ] as SourceDeveloper[],
} satisfies ExtensionInfo;
