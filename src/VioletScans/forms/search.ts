/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import { STATUS_OPTIONS, TYPE_OPTIONS, type GenreOption, type SearchMetadata } from "../models";

export class VioletScansAdvancedSearchForm extends AdvancedSearchForm {
  private genres: Record<string, "included" | "excluded">;
  private status: string[];
  private type: string[];
  private readonly genreOptions: GenreOption[];

  constructor(query: SearchQuery<SearchMetadata>, genreOptions: GenreOption[]) {
    super();
    const metadata = { genres: {}, status: [], type: [], ...query.metadata };
    this.genres = { ...metadata.genres };
    this.status = metadata.status;
    this.type = metadata.type;
    this.genreOptions = genreOptions;
  }

  override getSections() {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: false,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as VioletScansAdvancedSearchForm,
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
            this as VioletScansAdvancedSearchForm,
            "handleStatusChange",
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
            this as VioletScansAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (this.status.length > 0) metadata.status = this.status;
    if (this.type.length > 0) metadata.type = this.type;
    return metadata;
  }
}
