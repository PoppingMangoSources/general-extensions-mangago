/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { ContentPreferenceRating, SeriesType } from "../shared/models";

export const CONTENT_TYPE_OPTIONS: Array<{ id: SeriesType; title: string }> = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "oel", title: "OEL" },
];

export const CONTENT_RATING_OPTIONS: Array<{
  id: ContentPreferenceRating;
  title: string;
}> = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];
