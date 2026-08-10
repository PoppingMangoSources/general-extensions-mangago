/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, type Tag } from "@paperback/types";

import {
  SAFE_ID_REGEX,
  TAG_LIMIT,
  type ChapterItem,
  type GenreOption,
  type Medium,
  type SeriesStatus,
  type TagOption,
} from "./models";

export const sanitizeId = (value: string): string => value.replace(SAFE_ID_REGEX, "-");

export const encodeMangaId = (slug: string, medium: Medium): string =>
  medium === "novel" ? `novel:${sanitizeId(slug)}` : sanitizeId(slug);

export const decodeMangaId = (mangaId: string): { medium: Medium; slug: string } =>
  mangaId.startsWith("novel:")
    ? { medium: "novel", slug: mangaId.slice("novel:".length) }
    : { medium: "comic", slug: mangaId };

export const formatCoverUrl = (url: string, width: 200 | 400 | 600 = 400): string =>
  url.replace(/\.webp(?:\?.*)?$/i, `_${width}.webp`);

export const formatSeriesType = (type: string, medium: Medium = "comic"): string => {
  if (medium === "novel") {
    switch (type) {
      case "light_novel":
        return "Light Novel";
      case "web_novel":
        return "Web Novel";
      case "published":
        return "Published";
      case "original":
        return "Original";
      default:
        return "Novel";
    }
  }
  return type === "oel" ? "OEL" : `${type[0]?.toUpperCase() ?? ""}${type.slice(1)}`;
};

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
  [...new Map(genres.map((genre) => [genre.slug, genre])).values()].map((genre) => ({
    id: sanitizeId(genre.slug),
    title: genre.name,
  }));

export const toTagOptions = (tags: TagOption[]): Tag[] =>
  [...new Map(tags.map((tag) => [tag.id, tag])).values()]
    .filter((tag) => tag.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, TAG_LIMIT)
    .map((tag) => ({ id: sanitizeId(String(tag.id)), title: tag.name }));

export const chapterTitle = (chapter: ChapterItem): string | undefined => {
  const title = chapter.title.trim();
  if (chapter.number == null) return title || "Oneshot";
  return title || undefined;
};
