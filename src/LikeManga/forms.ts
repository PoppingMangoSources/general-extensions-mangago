/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { MIN_CHAPTER_OPTIONS, STATUS_OPTIONS, type SearchMetadata, type TriState } from "./models";

export class LikeMangaAdvancedSearchForm extends AdvancedSearchForm {
  private genres: TriState;
  private minChapters: string[];
  private status: TriState;
  private keyword: string;
  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreOptions: Tag[]) {
    super();
    const metadata = searchQuery.metadata ?? {};
    this.genres = { ...metadata.genres };
    this.minChapters = metadata.minChapters ?? [];
    this.status = { ...metadata.status };
    this.keyword = metadata.keyword ?? "";
    this.genreOptions = genreOptions;
  }

  override getSections() {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
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
        TriStateSelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: STATUS_OPTIONS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as LikeMangaAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("keyword", [
        InputRow("keyword", {
          title: "Keyword",
          value: this.keyword,
          onValueChange: Application.Selector(
            this as LikeMangaAdvancedSearchForm,
            "handleKeywordChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleMinChaptersChange(value: string[]): Promise<void> {
    this.minChapters = value;
  }

  async handleStatusChange(value: TriState): Promise<void> {
    this.status = value;
  }

  async handleKeywordChange(value: string): Promise<void> {
    this.keyword = value.trim();
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      ...(Object.keys(this.genres).length > 0 && { genres: this.genres }),
      ...(this.minChapters[0] && this.minChapters[0] !== "1"
        ? { minChapters: this.minChapters }
        : {}),
      ...(Object.keys(this.status).length > 0 && { status: this.status }),
      ...(this.keyword && { keyword: this.keyword }),
    };
  }
}
