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

export function customVersion(
  options?:
    | {
        increaseMajor?: number;
        increaseMinor?: number;
        increasePatch?: number;
      }
    | {
        increasePrerelease: number;
      },
): string {
  if (!options) {
    return BASE_VERSION;
  }

  const baseParts = BASE_VERSION.split("-");
  if (!baseParts[0]) {
    throw new Error(`Invalid BASE_VERSION: '${BASE_VERSION}'. Version string cannot be empty.`);
  }
  const versionNumbers = baseParts[0].split(".").map(Number);
  const isPrerelease = baseParts.length > 1;

  if (versionNumbers.length < 3) {
    throw new Error(
      `Invalid BASE_VERSION: '${BASE_VERSION}'. Expected format: 'X.Y.Z' or 'X.Y.Z-prerelease.N'`,
    );
  }

  if ("increasePrerelease" in options) {
    if (!isPrerelease) {
      throw new Error("Cannot set a prerelease number on a stable version.");
    }

    if (!baseParts[1]) {
      throw new Error(`Invalid BASE_VERSION: '${BASE_VERSION}'. Missing prerelease identifier.`);
    }

    const prereleaseParts = baseParts[1].split(".");
    if (prereleaseParts.length < 2 || isNaN(Number(prereleaseParts[1]))) {
      throw new Error(
        `Invalid prerelease format in BASE_VERSION: '${BASE_VERSION}'. Expected format: 'X.Y.Z-prerelease.N'`,
      );
    }

    const newPrereleaseNum = Number(prereleaseParts[1]) + options.increasePrerelease;
    return `${baseParts[0]}-${prereleaseParts[0]}.${newPrereleaseNum}`;
  }

  if (isPrerelease) {
    throw new Error("BASE_VERSION is a prerelease. Use increasePrerelease option instead.");
  }

  const hasVersionIncrement =
    options.increaseMajor !== undefined ||
    options.increaseMinor !== undefined ||
    options.increasePatch !== undefined;

  if (!hasVersionIncrement) {
    throw new Error(
      "Empty options object provided. Either specify version increments or call getVersion() with no arguments.",
    );
  }

  const newMajor = (versionNumbers[0] ?? 0) + (options.increaseMajor || 0);
  const newMinor = (versionNumbers[1] ?? 0) + (options.increaseMinor || 0);
  const newPatch = (versionNumbers[2] ?? 0) + (options.increasePatch || 0);

  return `${newMajor}.${newMinor}.${newPatch}`;
}
