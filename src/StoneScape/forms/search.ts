/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  CONTENT_TYPE_OPTIONS,
  STATUS_OPTIONS,
  type PopularPeriod,
  type SearchMetadata,
  type TriState,
} from "../models";

export class StoneScapeAdvancedSearchForm extends AdvancedSearchForm {
  private status: TriState;
  private contentType: TriState;
  private genres: TriState;
  private popularPeriod?: PopularPeriod;

  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreOptions: Tag[]) {
    super();
    const metadata = searchQuery.metadata ?? {};
    this.status = { ...metadata.status };
    this.contentType = { ...metadata.contentType };
    this.genres = { ...metadata.genres };
    this.popularPeriod = metadata.popularPeriod;
    this.genreOptions = genreOptions;
  }

  override getSections() {
    return [
      Section("type", [
        TriStateSelectRow("type", {
          title: "Content Type",
          layout: "flow",
          value: this.contentType,
          items: CONTENT_TYPE_OPTIONS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as StoneScapeAdvancedSearchForm,
            "handleContentTypeChange",
          ),
        }),
      ]),
      Section("status", [
        TriStateSelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: STATUS_OPTIONS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as StoneScapeAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as StoneScapeAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
    ];
  }

  async handleContentTypeChange(value: TriState): Promise<void> {
    this.contentType = value;
    this.popularPeriod = undefined;
  }

  async handleStatusChange(value: TriState): Promise<void> {
    this.status = value;
    this.popularPeriod = undefined;
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
    this.popularPeriod = undefined;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      ...(Object.keys(this.status).length > 0 && { status: this.status }),
      ...(Object.keys(this.contentType).length > 0 && { contentType: this.contentType }),
      ...(Object.keys(this.genres).length > 0 && { genres: this.genres }),
      ...(this.popularPeriod && { popularPeriod: this.popularPeriod }),
    };
  }
}
