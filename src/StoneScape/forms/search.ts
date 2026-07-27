/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  CONTENT_TYPE_OPTIONS,
  STATUS_OPTIONS,
  type PopularPeriod,
  type SearchMetadata,
} from "../models";

export class StoneScapeAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private contentType: string[];
  private genres: string[];
  private popularPeriod?: PopularPeriod;

  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreOptions: Tag[]) {
    super();
    const metadata = searchQuery.metadata ?? {};
    this.status = metadata.status ?? [];
    this.contentType = metadata.contentType ?? [];
    this.genres = metadata.genres ?? [];
    this.popularPeriod = metadata.popularPeriod;
    this.genreOptions = genreOptions;
  }

  override getSections() {
    return [
      Section("type", [
        SelectRow("type", {
          title: "Content Type",
          layout: "flow",
          value: this.contentType,
          items: CONTENT_TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as StoneScapeAdvancedSearchForm,
            "handleContentTypeChange",
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
            this as StoneScapeAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("genres", [
        SelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          minItemCount: 0,
          maxItemCount: this.genreOptions.length,
          onValueChange: Application.Selector(
            this as StoneScapeAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
    ];
  }

  async handleContentTypeChange(value: string[]): Promise<void> {
    this.contentType = value;
    this.popularPeriod = undefined;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
    this.popularPeriod = undefined;
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.genres = value;
    this.popularPeriod = undefined;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      ...(this.status.length > 0 && { status: this.status }),
      ...(this.contentType.length > 0 && { contentType: this.contentType }),
      ...(this.genres.length > 0 && { genres: this.genres }),
      ...(this.popularPeriod && { popularPeriod: this.popularPeriod }),
    };
  }
}
