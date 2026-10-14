/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ExtensionInfo } from "@paperback/types";

import ToonkotsuConfig from "../Toonkotsu/pbconfig";

export default {
  ...ToonkotsuConfig,
  name: "ToonkotsuSortCheck",
  description:
    "Temporary Toonkotsu sorting diagnostic. Uses fresh chapter records and displays each sorting index.",
  version: "1.0.0-alpha.1",
  badges: [{ label: "Sorting Test", textColor: "#ffffff", backgroundColor: "#9368a8" }],
} satisfies ExtensionInfo;
