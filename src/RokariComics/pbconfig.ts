/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type ExtensionInfo } from "@paperback/types";

import { basePbConfig } from "./generic/config";

export default {
  ...basePbConfig,
  name: "RokariComics",
  description: "Extension that pulls content from rokaricomics.com.",
  version: "1.0.0-alpha.16",
  developers: [{ name: "Popmango", github: "https://github.com/PoppingMangoSources" }],
} satisfies ExtensionInfo;
