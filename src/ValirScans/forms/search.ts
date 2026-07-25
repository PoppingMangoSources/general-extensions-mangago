/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import {
  ORIGIN_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type FilterOption,
  type SearchMetadata,
  type TriState,
} from "../models";

export class ValirScansAdvancedSearchForm extends AdvancedSearchForm {
  private searchMetadata: SearchMetadata;

  constructor(
    searchQuery: SearchQuery<SearchMetadata>,
    private readonly genres: FilterOption[],
    private readonly tags: FilterOption[],
  ) {
    super();
    this.searchMetadata = searchQuery.metadata ?? {};
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return this.searchMetadata;
  }

  private triStateSection(
    id: "genres" | "tags" | "types" | "statuses" | "origins",
    title: string,
    items: FilterOption[],
    handler:
      | "handleGenresChange"
      | "handleTagsChange"
      | "handleTypesChange"
      | "handleStatusesChange"
      | "handleOriginsChange",
  ) {
    return Section({ id, footer: "Tap once to include, twice to exclude." }, [
      TriStateSelectRow(id, {
        title,
        layout: "flow",
        value: this.searchMetadata[id] ?? {},
        items,
        allowExclusion: true,
        allowEmptySelection: true,
        onValueChange: Application.Selector(this as ValirScansAdvancedSearchForm, handler),
      }),
    ]);
  }

  override getSections() {
    return [
      this.triStateSection("genres", "Genres", this.genres, "handleGenresChange"),
      this.triStateSection("tags", "Tags", this.tags, "handleTagsChange"),
      this.triStateSection("types", "Types", TYPE_OPTIONS, "handleTypesChange"),
      this.triStateSection("statuses", "Status", STATUS_OPTIONS, "handleStatusesChange"),
      this.triStateSection("origins", "Origins", ORIGIN_OPTIONS, "handleOriginsChange"),
      Section({ id: "chapter_count", footer: "Number of chapters, e.g. 20 to 100." }, [
        InputRow("min_chapters", {
          title: "Chapters From",
          value: this.searchMetadata.minChapters ?? "",
          onValueChange: Application.Selector(
            this as ValirScansAdvancedSearchForm,
            "handleMinChaptersChange",
          ),
        }),
        InputRow("max_chapters", {
          title: "Chapters To",
          value: this.searchMetadata.maxChapters ?? "",
          onValueChange: Application.Selector(
            this as ValirScansAdvancedSearchForm,
            "handleMaxChaptersChange",
          ),
        }),
      ]),
    ];
  }

  // Store `undefined` instead of an empty record so the metadata stays sparse.
  private static sparse(value: TriState): TriState | undefined {
    return Object.keys(value).length === 0 ? undefined : value;
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.searchMetadata.genres = ValirScansAdvancedSearchForm.sparse(value);
  }

  async handleTagsChange(value: TriState): Promise<void> {
    this.searchMetadata.tags = ValirScansAdvancedSearchForm.sparse(value);
  }

  async handleTypesChange(value: TriState): Promise<void> {
    this.searchMetadata.types = ValirScansAdvancedSearchForm.sparse(value);
  }

  async handleStatusesChange(value: TriState): Promise<void> {
    this.searchMetadata.statuses = ValirScansAdvancedSearchForm.sparse(value);
  }

  async handleOriginsChange(value: TriState): Promise<void> {
    this.searchMetadata.origins = ValirScansAdvancedSearchForm.sparse(value);
  }

  async handleMinChaptersChange(value: string): Promise<void> {
    this.searchMetadata.minChapters = value.replace(/\D/g, "") || undefined;
  }

  async handleMaxChaptersChange(value: string): Promise<void> {
    this.searchMetadata.maxChapters = value.replace(/\D/g, "") || undefined;
  }
}
