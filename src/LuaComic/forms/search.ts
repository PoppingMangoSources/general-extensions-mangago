/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { STATUS_OPTIONS, type OptionItem, type SearchMetadata } from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

export class LuaComicAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private genres: Record<string, "included" | "excluded">;

  private readonly statusOptions: Tag[] = STATUS_OPTIONS;
  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreOptions: OptionItem[]) {
    super();
    this.genreOptions = toTags(genreOptions);

    const meta = searchQuery.metadata ?? {};
    this.status = meta.status ?? [];
    this.genres = { ...meta.genres };
  }

  override getSections() {
    const sections = [
      Section("status", [
        SelectRow("status", {
          title: "Series Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as LuaComicAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
    ];

    if (this.genreOptions.length > 0) {
      sections.push(
        Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
          TriStateSelectRow("genres", {
            title: "Genres",
            layout: "flow",
            value: this.genres,
            items: this.genreOptions,
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: Application.Selector(
              this as LuaComicAdvancedSearchForm,
              "handleGenresChange",
            ),
          }),
        ]),
      );
    }

    return sections;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.status.length > 0) result.status = this.status;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    return result;
  }
}
