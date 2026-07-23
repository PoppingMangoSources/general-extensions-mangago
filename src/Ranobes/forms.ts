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

import { GENRE_OPTIONS, LANGUAGE_OPTIONS, STATUS_OPTIONS, type SearchMetadata } from "./models";

export class RanobesAdvancedSearchForm extends AdvancedSearchForm {
  private readonly searchMetadata: SearchMetadata;

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    this.searchMetadata = { ...searchQuery.metadata };
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return this.searchMetadata;
  }

  override getSections() {
    return [
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.searchMetadata.genres ?? {},
          items: GENRE_OPTIONS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section("filters", [
        SelectRow("language", {
          title: "Language",
          layout: "list",
          value: this.searchMetadata.language ? [this.searchMetadata.language] : [],
          items: LANGUAGE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleLanguageChange",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.searchMetadata.status ? [this.searchMetadata.status] : [],
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
        InputRow("author", {
          title: "Author",
          value: this.searchMetadata.author ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        InputRow("translator", {
          title: "Translator",
          value: this.searchMetadata.translator ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleTranslatorChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.searchMetadata.genres = value;
  }

  async handleLanguageChange(value: string[]): Promise<void> {
    this.searchMetadata.language = value[0] || undefined;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.searchMetadata.status = value[0] || undefined;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.searchMetadata.author = value.trim() || undefined;
  }

  async handleTranslatorChange(value: string): Promise<void> {
    this.searchMetadata.translator = value.trim() || undefined;
  }
}
