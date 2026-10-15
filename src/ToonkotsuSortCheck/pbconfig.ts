/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ExtensionInfo } from "@paperback/types";

import ToonkotsuConfig from "../Toonkotsu/pbconfig";

export default {
  ...ToonkotsuConfig,
  name: "ToonkotsuSortCheck",
  description:
    "Temporary Toonkotsu sorting test. Adds volume suffixes to chapter numbers that clash across volumes.",
  version: "1.0.0-alpha.2",
  badges: [{ label: "Sorting Test", textColor: "#ffffff", backgroundColor: "#9368a8" }],
} satisfies ExtensionInfo;
