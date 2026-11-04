/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export interface ListingFacts {
  chapter?: number | string | null;
  chapterCount?: number | null;
  type?: string;
  rating?: number | string | null;
  views?: number | string;
  follows?: number | string;
}

export const formatCount = (value: number | string | undefined): string | undefined => {
  if (value === undefined || value === "") return undefined;
  const match = /^([\d.,]+)\s*([KMB])?$/i.exec(String(value).trim());
  if (!match) return undefined;
  const number =
    Number(match[1].replaceAll(",", "")) *
    ({ K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] ?? 1);
  if (!Number.isFinite(number)) return undefined;
  for (const [scale, suffix] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const)
    if (number >= scale) return `${(number / scale).toFixed(1).replace(/\.0$/, "")}${suffix}`;
  return String(number);
};

export const formatListingSubtitle = (facts: ListingFacts): string | undefined => {
  const chapter =
    facts.chapter !== undefined &&
    facts.chapter !== null &&
    facts.chapter !== "" &&
    Number.isFinite(Number(facts.chapter))
      ? `Ch. ${Number(facts.chapter)}`
      : facts.chapterCount !== undefined &&
          facts.chapterCount !== null &&
          Number.isFinite(facts.chapterCount)
        ? `${facts.chapterCount} Chs`
        : undefined;
  const rating =
    facts.rating != null && Number(facts.rating) > 0 ? `★ ${Number(facts.rating)}` : undefined;
  const views = formatCount(facts.views),
    follows = formatCount(facts.follows);
  const extra =
    facts.type?.trim() ||
    rating ||
    (views ? `▶︎ ${views}` : undefined) ||
    (follows ? `♥ ${follows}` : undefined);
  return [chapter, extra].filter(Boolean).join(" • ") || undefined;
};
