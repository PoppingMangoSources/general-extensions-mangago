/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SourceManga } from "@paperback/types";

import { DOMAIN, type Medium, type SeriesDetails } from "../shared/models";
import {
  encodeMangaId,
  formatCoverUrl,
  formatSeriesStatus,
  formatSeriesType,
  formatViews,
  sanitizeId,
  toContentRating,
} from "../shared/parsers";

export const parseMangaDetails = (series: SeriesDetails, medium: Medium): SourceManga => {
  const authors = series.authors
    .filter((credit) => credit.role === "author")
    .map((credit) => credit.name)
    .join(", ");
  const artists = series.authors
    .filter((credit) => credit.role === "artist")
    .map((credit) => credit.name)
    .join(", ");

  return {
    mangaId: encodeMangaId(series.slug, medium),
    mangaInfo: {
      primaryTitle: series.title,
      secondaryTitles: series.alt_titles,
      thumbnailUrl: formatCoverUrl(series.cover_url, 600),
      synopsis: series.description,
      contentRating: toContentRating(series.is_nsfw),
      contentType: medium === "novel" ? "novel" : "comic",
      status: formatSeriesStatus(series.status),
      author: authors || undefined,
      artist: artists || undefined,
      rating:
        series.rating == null || !Number.isFinite(series.rating)
          ? undefined
          : Math.min(1, Math.max(0, series.rating / 10)),
      tagGroups: [
        {
          id: "genres",
          title: "Genres",
          tags: series.genres.map((genre) => ({
            id: sanitizeId(genre.slug),
            title: genre.name,
          })),
        },
        {
          id: "tags",
          title: "Tags",
          tags: series.tags
            .filter((tag) => !tag.is_spoiler)
            .map((tag) => ({
              id: sanitizeId(String(tag.id)),
              title: tag.name,
            })),
        },
      ],
      artworkUrls: [formatCoverUrl(series.cover_url, 600), series.cover_url],
      additionalInfo: {
        Type: formatSeriesType(series.type, medium),
        Chapters: String(series.chapter_count),
        Views: formatViews(series.views),
        ...(series.year ? { Year: String(series.year) } : {}),
      },
      shareUrl: `${DOMAIN}/${medium === "novel" ? "novels" : "series"}/${series.slug}`,
    },
  };
};
