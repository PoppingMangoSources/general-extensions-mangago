/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import type { SearchMetadata, SearchOptions } from "./models";

type FilterKey = "genre" | "status" | "year" | "letter";
type Handler =
  | "handleGenreChange"
  | "handleStatusChange"
  | "handleYearChange"
  | "handleLetterChange";

// Mirrors the site's category directory: each option is its own page, so picking one clears the
// others, as the site does.
export class NovelCoolAdvancedSearchForm extends AdvancedSearchForm {
  private filter: { key: FilterKey; id: string } | undefined;

  constructor(
    searchQuery: SearchQuery<SearchMetadata>,
    private readonly options: SearchOptions,
  ) {
    super();
    const metadata = searchQuery.metadata ?? {};
    const key = (["genre", "status", "year", "letter"] as const).find(
      (name) => metadata[name]?.[0],
    );
    const id = key ? metadata[key]?.[0] : undefined;
    this.filter = key && id ? { key, id } : undefined;
  }

  private row(key: FilterKey, title: string, items: Tag[], handler: Handler) {
    return SelectRow(key, {
      title,
      layout: "flow",
      value: this.filter?.key === key ? [this.filter.id] : [],
      items,
      minItemCount: 0,
      maxItemCount: 1,
      onValueChange: Application.Selector(this as NovelCoolAdvancedSearchForm, handler),
    });
  }

  override getSections() {
    return [
      Section(
        {
          id: "browse",
          footer:
            "The site lists one of these at a time, and not alongside a typed title, which searches on its own.",
        },
        [
          this.row("genre", "Genre", this.options.genres, "handleGenreChange"),
          this.row("status", "Status", this.options.statuses, "handleStatusChange"),
          this.row("year", "Year", this.options.years, "handleYearChange"),
          this.row("letter", "Alphabetic", this.options.letters, "handleLetterChange"),
        ],
      ),
    ];
  }

  private select(key: FilterKey, value: string[]): void {
    this.filter = value[0] ? { key, id: value[0] } : undefined;
    this.reloadForm();
  }

  async handleGenreChange(value: string[]): Promise<void> {
    this.select("genre", value);
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.select("status", value);
  }

  async handleYearChange(value: string[]): Promise<void> {
    this.select("year", value);
  }

  async handleLetterChange(value: string[]): Promise<void> {
    this.select("letter", value);
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return this.filter ? { [this.filter.key]: [this.filter.id] } : {};
  }
}
