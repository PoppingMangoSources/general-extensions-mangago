/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  ToggleRow,
  type SearchQuery,
} from "@paperback/types";

import type { FilterOptions, SearchMetadata } from "./models";

export class RoliascanAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private matchAllGenres: boolean;
  private type: string;
  private status: string;
  private year: string;

  constructor(
    query: SearchQuery<SearchMetadata>,
    private options: FilterOptions,
  ) {
    super();
    const meta = query.metadata ?? {};
    this.genres = meta.genres ?? [];
    this.matchAllGenres = meta.matchAllGenres ?? false;
    this.type = meta.type ?? "";
    this.status = meta.status ?? "";
    this.year = meta.year ?? "";
  }

  override getSections() {
    return [
      Section("genres", [
        SelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.options.genres,
          minItemCount: 0,
          maxItemCount: this.options.genres.length,
          onValueChange: Application.Selector(
            this as RoliascanAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
        ToggleRow("match_all", {
          title: "Match All Genres",
          subtitle: "Titles must have every selected genre.",
          value: this.matchAllGenres,
          onValueChange: Application.Selector(
            this as RoliascanAdvancedSearchForm,
            "handleMatchAllChange",
          ),
        }),
      ]),
      Section("type", [
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: this.type ? [this.type] : [],
          items: this.options.types,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RoliascanAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status ? [this.status] : [],
          items: this.options.statuses,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RoliascanAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("year", [
        SelectRow("year", {
          title: "Year",
          layout: "list",
          value: this.year ? [this.year] : [],
          items: this.options.years,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RoliascanAdvancedSearchForm,
            "handleYearChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.genres = value;
  }

  async handleMatchAllChange(value: boolean): Promise<void> {
    this.matchAllGenres = value;
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value[0] ?? "";
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value[0] ?? "";
  }

  async handleYearChange(value: string[]): Promise<void> {
    this.year = value[0] ?? "";
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.genres.length > 0) result.genres = this.genres;
    if (this.matchAllGenres) result.matchAllGenres = true;
    if (this.type) result.type = this.type;
    if (this.status) result.status = this.status;
    if (this.year) result.year = this.year;
    return result;
  }
}
