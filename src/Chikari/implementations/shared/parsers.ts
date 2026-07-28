/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, type Tag } from "@paperback/types";

import {
  SAFE_ID_REGEX,
  TAG_LIMIT,
  type ChapterItem,
  type GenreOption,
  type SeriesStatus,
  type SeriesType,
  type TagOption,
} from "./models";

export const sanitizeId = (value: string): string => value.replace(SAFE_ID_REGEX, "-");

export const formatCoverUrl = (url: string, width: 200 | 400 | 600 = 400): string =>
  url.replace(/\.webp(?:\?.*)?$/i, `_${width}.webp`);

export const formatSeriesType = (type: SeriesType): string =>
  type === "oel" ? "OEL" : `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;

export const formatSeriesStatus = (status: SeriesStatus): string =>
  `${status[0]?.toUpperCase() ?? ""}${status.slice(1)}`;

export const formatRating = (rating: number | null): string | undefined =>
  rating == null || !Number.isFinite(rating) ? undefined : `★ ${rating.toFixed(1)}`;

export const formatViews = (views: number): string => {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1).replace(/\.0$/, "")}K views`;
  return `${views} views`;
};

export const formatChapterNumber = (number: number | null): string =>
  number == null ? "Oneshot" : String(number);

export const chapterToken = (number: number | null): string =>
  sanitizeId(number == null ? "oneshot" : String(number));

export const toContentRating = (isNsfw: boolean): ContentRating =>
  isNsfw ? ContentRating.ADULT : ContentRating.EVERYONE;

export const toGenreOptions = (genres: GenreOption[]): Tag[] =>
  genres.map((genre) => ({ id: sanitizeId(genre.slug), title: genre.name }));

export const toTagOptions = (tags: TagOption[]): Tag[] =>
  [...tags]
    .filter((tag) => tag.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, TAG_LIMIT)
    .map((tag) => ({ id: sanitizeId(String(tag.id)), title: tag.name }));

export const chapterTitle = (chapter: ChapterItem): string | undefined => {
  const title = chapter.title.trim();
  if (chapter.number == null) return title || "Oneshot";
  return title || undefined;
};
