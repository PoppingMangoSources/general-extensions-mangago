/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { MangaStreamGeneric } from "./main";
import { type Months } from "./models";

export function convertDate(dateString: string, source: MangaStreamGeneric): Date {
  // Parsed date string
  dateString = dateString.toLowerCase();

  // Month formats provided by the source
  const dateMonths: Months = source.dateMonths;

  let date: Date | null = null;

  for (const [key, value] of Object.entries(dateMonths)) {
    if (dateString.toLowerCase().includes((value as string).toLowerCase())) {
      date = new Date(dateString.replace(value as string, key ?? ""));
    }
  }

  if (!date || String(date) == "Invalid Date") {
    console.log(
      "Failed to parse chapter date! TO DEV: Please check if the entered months reflect the sites months",
    );
    return new Date();
  }
  return date;
}

export function getIncludedTagBySection(section: string, tags: string[]): string {
  return (
    tags?.find((x: string) => x.startsWith(`${section}_`))?.replace(`${section}_`, "") ?? ""
  ).replace(" ", "+");
}

export function getFilterTagsBySection(
  section: string,
  tags: string[],
  included: boolean,
  supportsExclusion = false,
): string[] {
  if (!included && !supportsExclusion) {
    return [];
  }

  return tags
    ?.filter((x: string) => x.startsWith(`${section}_`))
    .map((x: string) => {
      let id: string = x.replace(`${section}_`, "");
      if (!included) {
        id = encodeURI(`-${id}`);
      }
      return id;
    });
}
