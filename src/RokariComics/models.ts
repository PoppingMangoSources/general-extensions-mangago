/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SortingOption } from "@paperback/types";

export const DOMAIN = "https://rokaricomics.com";

export const SECTIONS = {
  FEATURED: "featured",
  POPULAR: "popular",
  LATEST_UPDATES: "latest_updates",
  RECOMMENDATION: "recommendation",
  POPULAR_RANKING: "popular_ranking",
} as const;

export const RANKING_RANGES = [
  { id: "weekly", title: "Weekly" },
  { id: "monthly", title: "Monthly" },
  { id: "alltime", title: "All-Time" },
] as const;

export const SORT_OPTIONS: SortingOption[] = [
  { id: "default", label: "Default" },
  { id: "title", label: "A-Z" },
  { id: "titlereverse", label: "Z-A" },
  { id: "update", label: "Update" },
  { id: "latest", label: "Added" },
  { id: "popular", label: "Popular" },
];
