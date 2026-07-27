/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { MIN_CHAPTER_OPTIONS, STATUS_OPTIONS, type SearchMetadata } from "./models";

export class LikeMangaAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private minChapters: string[];
  private status: string[];
  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreOptions: Tag[]) {
    super();
    const metadata = searchQuery.metadata ?? {};
    this.genres = metadata.genres ?? [];
    this.minChapters = metadata.minChapters ?? [];
    this.status = metadata.status ?? [];
    this.genreOptions = genreOptions;
  }

  override getSections() {
    return [
      Section("genres", [
        SelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          minItemCount: 0,
          maxItemCount: this.genreOptions.length,
          onValueChange: Application.Selector(
            this as LikeMangaAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section("chapters", [
        SelectRow("minimum_chapters", {
          title: "Minimum Chapters",
          layout: "flow",
          value: this.minChapters,
          items: MIN_CHAPTER_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as LikeMangaAdvancedSearchForm,
            "handleMinChaptersChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as LikeMangaAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.genres = value;
  }

  async handleMinChaptersChange(value: string[]): Promise<void> {
    this.minChapters = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      ...(this.genres.length > 0 && { genres: this.genres }),
      ...(this.minChapters[0] && this.minChapters[0] !== "1"
        ? { minChapters: this.minChapters }
        : {}),
      ...(this.status.length > 0 && { status: this.status }),
    };
  }
}
