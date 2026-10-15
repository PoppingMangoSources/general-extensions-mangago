/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter } from "@paperback/types";

const MIN_VOLUME_SUFFIX_DIGITS = 3;

const decimalPlaces = (value: number): number => {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Math.max(0, (mantissa?.split(".")[1]?.length ?? 0) - Number(exponent));
};

export const parseChapters = (chapters: Chapter[]): Chapter[] => {
  if (!chapters.length) return chapters;
  const knownVolumes = [...new Set(chapters.flatMap(({ volume }) => volume ?? []))];
  const unassignedVolume = Math.floor(Math.max(0, ...knownVolumes)) + 1;
  const volumes = [...knownVolumes, unassignedVolume];
  const offset = Math.min(0, ...volumes);
  // Scale fractional volumes together so each volume has a distinct integer suffix.
  const scale = 10 ** Math.max(...volumes.map(decimalPlaces));
  const volumesByNumber = new Map<number, Set<number>>();
  for (const chapter of chapters) {
    const values = volumesByNumber.get(chapter.chapNum) ?? new Set<number>();
    values.add(chapter.volume ?? unassignedVolume);
    volumesByNumber.set(chapter.chapNum, values);
  }
  const lowestVolumes = new Map(
    [...volumesByNumber].map(([number, values]) => [number, Math.min(...values)]),
  );
  let width = Math.max(
    MIN_VOLUME_SUFFIX_DIGITS,
    String(Math.round((Math.max(...volumes) - offset) * scale)).length,
  );
  for (;;) {
    const occupied = new Map<number, string>();
    const parsed: Chapter[] = [];
    let collision = false;
    for (const chapter of chapters) {
      const volume = chapter.volume ?? unassignedVolume;
      const key = JSON.stringify([volume, chapter.chapNum]);
      let number = chapter.chapNum;
      if (volume !== lowestVolumes.get(chapter.chapNum)) {
        const original = number.toFixed(decimalPlaces(number));
        const suffix = String(Math.round((volume - offset) * scale)).padStart(width, "0");
        number = Number(`${original}${original.includes(".") ? "" : "."}${suffix}`);
        if (!Number.isFinite(number) || number === chapter.chapNum) {
          throw new Error("Cannot separate these chapter numbers without losing precision.");
        }
      }
      const previous = occupied.get(number);
      if (previous !== undefined && previous !== key) {
        collision = true;
        break;
      }
      occupied.set(number, key);
      parsed.push({ ...chapter, chapNum: number });
    }
    if (!collision) {
      return parsed;
    }
    // A real fractional chapter may already use the proposed suffix; try a longer one.
    width++;
  }
};
