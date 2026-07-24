/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  SelectSection,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  GENRE_MODE_OPTIONS,
  GENRES,
  STATUS_OPTIONS,
  type OptionItem,
  type SearchMetadata,
} from "./models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

export class KaliScanAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private author: string;
  private genres: Record<string, "included" | "excluded">;
  private genreMode: string[];

  private readonly statusOptions: Tag[] = toTags(STATUS_OPTIONS);
  private readonly genreOptions: Tag[] = toTags(GENRES);

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.status = meta.status ?? [];
    this.author = meta.author ?? "";
    this.genres = { ...meta.genres };
    this.genreMode = meta.genreMode ?? ["and"];
  }

  override getSections() {
    return [
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as KaliScanAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("author", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as KaliScanAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as KaliScanAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      SelectSection(this, {
        id: "genre_mode",
        layout: "flow",
        value: this.genreMode,
        items: toTags(GENRE_MODE_OPTIONS),
        minItemCount: 1,
        maxItemCount: 1,
      }),
    ];
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.status.length > 0) result.status = this.status;
    if (this.author.trim()) result.author = this.author.trim();
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    if (this.genreMode.length > 0) result.genreMode = this.genreMode;
    return result;
  }
}
