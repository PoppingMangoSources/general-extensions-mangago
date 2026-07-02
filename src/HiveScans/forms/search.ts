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

import {
  DIRECTION_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type OptionItem,
  type SearchMetadata,
} from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

export class HiveScansAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private type: string[];
  private direction: string[];
  private genres: Record<string, "included" | "excluded">;

  private readonly statusOptions: Tag[] = toTags(STATUS_OPTIONS);
  private readonly typeOptions: Tag[] = toTags(TYPE_OPTIONS);
  private readonly directionOptions: Tag[] = toTags(DIRECTION_OPTIONS);
  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreOptions: OptionItem[]) {
    super();
    this.genreOptions = toTags(genreOptions);

    const meta = searchQuery.metadata ?? {};
    this.status = meta.status ?? [];
    this.type = meta.type ?? [];
    this.direction = meta.direction ?? [];
    this.genres = { ...meta.genres };
  }

  override getSections() {
    const sections = [
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as HiveScansAdvancedSearchForm,
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
            this as HiveScansAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),
      ]),
      Section("direction", [
        SelectRow("direction", {
          title: "Sort Direction",
          layout: "flow",
          value: this.direction,
          items: this.directionOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as HiveScansAdvancedSearchForm,
            "handleDirectionChange",
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
              this as HiveScansAdvancedSearchForm,
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

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value;
  }

  async handleDirectionChange(value: string[]): Promise<void> {
    this.direction = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.status.length > 0) result.status = this.status;
    if (this.type.length > 0) result.type = this.type;
    if (this.direction.length > 0) result.direction = this.direction;

    if (Object.keys(this.genres).length > 0) result.genres = this.genres;

    return result;
  }
}
