/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import {
  MATCH_OPTIONS,
  RATING_OPTIONS,
  STATUS_OPTIONS,
  type SearchMetadata,
  type SearchOptions,
  type TriState,
} from "./models";

export class NovelCoolAdvancedSearchForm extends AdvancedSearchForm {
  private nameMethod: string[];
  private author: string;
  private authorMethod: string[];
  private status: string[];
  private genres: TriState;
  private year: string[];
  private rating: string[];
  private readonly options: SearchOptions;

  constructor(searchQuery: SearchQuery<SearchMetadata>, options: SearchOptions) {
    super();
    const metadata = searchQuery.metadata ?? {};
    this.nameMethod = metadata.nameMethod ?? [];
    this.author = metadata.author ?? "";
    this.authorMethod = metadata.authorMethod ?? [];
    this.status = metadata.status ?? [];
    this.genres = { ...metadata.genres };
    this.year = metadata.year ?? [];
    this.rating = metadata.rating ?? [];
    this.options = options;
  }

  override getSections() {
    const sections = [
      Section("series", [
        SelectRow("name_method", {
          title: "Series Match",
          layout: "flow",
          value: this.nameMethod,
          items: MATCH_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelCoolAdvancedSearchForm,
            "handleNameMethodChange",
          ),
        }),
      ]),
      Section("author", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as NovelCoolAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        SelectRow("author_method", {
          title: "Author Match",
          layout: "flow",
          value: this.authorMethod,
          items: MATCH_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelCoolAdvancedSearchForm,
            "handleAuthorMethodChange",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.options.genres,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as NovelCoolAdvancedSearchForm,
            "handleGenresChange",
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
            this as NovelCoolAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("rating", [
        SelectRow("rating", {
          title: "Rating",
          layout: "flow",
          value: this.rating,
          items: RATING_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelCoolAdvancedSearchForm,
            "handleRatingChange",
          ),
        }),
      ]),
    ];

    if (this.options.years.length > 0) {
      sections.push(
        Section("year", [
          SelectRow("year", {
            title: "Year",
            layout: "flow",
            value: this.year,
            items: this.options.years,
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector(
              this as NovelCoolAdvancedSearchForm,
              "handleYearChange",
            ),
          }),
        ]),
      );
    }

    return sections;
  }

  async handleNameMethodChange(value: string[]): Promise<void> {
    this.nameMethod = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value.trim();
  }

  async handleAuthorMethodChange(value: string[]): Promise<void> {
    this.authorMethod = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleYearChange(value: string[]): Promise<void> {
    this.year = value;
  }

  async handleRatingChange(value: string[]): Promise<void> {
    this.rating = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.nameMethod.length > 0) result.nameMethod = this.nameMethod;
    if (this.author) result.author = this.author;
    if (this.authorMethod.length > 0) result.authorMethod = this.authorMethod;
    if (this.status.length > 0) result.status = this.status;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    if (this.year.length > 0) result.year = this.year;
    if (this.rating.length > 0) result.rating = this.rating;
    return result;
  }
}
