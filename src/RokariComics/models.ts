/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

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
