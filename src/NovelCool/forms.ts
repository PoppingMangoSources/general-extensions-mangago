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

import {
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type SearchMetadata,
  type SearchOptions,
  type TriState,
} from "./models";

export class NovelCoolAdvancedSearchForm extends AdvancedSearchForm {
  private author: string;
  private status: string[];
  private genres: TriState;
  private type: string[];
  private year: string[];
  private alphabet: string[];
  private readonly options: SearchOptions;

  constructor(searchQuery: SearchQuery<SearchMetadata>, options: SearchOptions) {
    super();
    const metadata = searchQuery.metadata ?? {};
    this.author = metadata.author ?? "";
    this.status = metadata.status ?? [];
    this.genres = { ...metadata.genres };
    this.type = metadata.type ?? [];
    this.year = metadata.year ?? [];
    this.alphabet = metadata.alphabet ?? [];
    this.options = options;
  }

  override getSections() {
    const sections = [
      Section("author", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as NovelCoolAdvancedSearchForm,
            "handleAuthorChange",
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
      Section("type", [
        SelectRow("type", {
          title: "Type",
          layout: "flow",
          value: this.type,
          items: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelCoolAdvancedSearchForm,
            "handleTypeChange",
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

    if (this.options.alphabets.length > 0) {
      sections.push(
        Section("alphabet", [
          SelectRow("alphabet", {
            title: "Alphabet",
            layout: "flow",
            value: this.alphabet,
            items: this.options.alphabets,
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector(
              this as NovelCoolAdvancedSearchForm,
              "handleAlphabetChange",
            ),
          }),
        ]),
      );
    }

    return sections;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value.trim();
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value;
  }

  async handleYearChange(value: string[]): Promise<void> {
    this.year = value;
  }

  async handleAlphabetChange(value: string[]): Promise<void> {
    this.alphabet = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.author) result.author = this.author;
    if (this.status.length > 0) result.status = this.status;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    if (this.type.length > 0) result.type = this.type;
    if (this.year.length > 0) result.year = this.year;
    if (this.alphabet.length > 0) result.alphabet = this.alphabet;
    return result;
  }
}
