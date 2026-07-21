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

import { STATUS_OPTIONS, TYPE_OPTIONS, type OptionItem, type SearchMetadata } from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

export class KingOfShojoAdvancedSearchForm extends AdvancedSearchForm {
  private author: string;
  private year: string;
  private status: string[];
  private type: string[];
  private genres: Record<string, "included" | "excluded">;

  private readonly statusOptions = toTags(STATUS_OPTIONS);
  private readonly typeOptions = toTags(TYPE_OPTIONS);
  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genres: OptionItem[]) {
    super();
    this.genreOptions = toTags(genres);

    const meta = searchQuery.metadata ?? {};
    this.author = meta.author ?? "";
    this.year = meta.year ?? "";
    this.status = meta.status ?? [];
    this.type = meta.type ?? [];
    this.genres = { ...meta.genres };
  }

  override getSections() {
    const sections = [
      Section("meta", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as KingOfShojoAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        InputRow("year", {
          title: "Year",
          value: this.year,
          onValueChange: Application.Selector(
            this as KingOfShojoAdvancedSearchForm,
            "handleYearChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as KingOfShojoAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("type", [
        SelectRow("type", {
          title: "Type",
          layout: "flow",
          value: this.type,
          items: this.typeOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as KingOfShojoAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),
      ]),
    ];

    if (this.genreOptions.length > 0) {
      sections.push(
        Section("genres", [
          TriStateSelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.genres,
            items: this.genreOptions,
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: Application.Selector(
              this as KingOfShojoAdvancedSearchForm,
              "handleGenresChange",
            ),
          }),
        ]),
      );
    }

    return sections;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleYearChange(value: string): Promise<void> {
    this.year = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.author.trim()) result.author = this.author.trim();
    if (this.year.trim()) result.year = this.year.trim();
    if (this.status.length > 0) result.status = this.status;
    if (this.type.length > 0) result.type = this.type;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    return result;
  }
}
