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
  AGE_OPTIONS,
  TYPE_OPTIONS,
  STATUS_OPTIONS,
  STAR_OPTIONS,
  type SearchMetadata,
} from "../models";
export class MGReadAdvancedSearchForm extends AdvancedSearchForm {
  private values: SearchMetadata;
  constructor(
    query: SearchQuery<SearchMetadata>,
    private readonly genres: Tag[],
  ) {
    super();
    this.values = { ...query.metadata };
  }
  override getSections() {
    return [
      Section("filters", [
        SelectRow("types", {
          title: "Type",
          value: this.values.types ?? [],
          items: TYPE_OPTIONS,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as MGReadAdvancedSearchForm, "handleTypes"),
        }),
        SelectRow("status", {
          title: "Status",
          value: this.values.status ?? [],
          items: STATUS_OPTIONS,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as MGReadAdvancedSearchForm, "handleStatus"),
        }),
        SelectRow("age", {
          title: "Age rating",
          value: this.values.age ?? [],
          items: AGE_OPTIONS,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as MGReadAdvancedSearchForm, "handleAge"),
        }),
        SelectRow("ratingMin", {
          title: "Minimum rating",
          value: this.values.ratingMin ?? [],
          items: STAR_OPTIONS,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as MGReadAdvancedSearchForm, "handleMin"),
        }),
        SelectRow("ratingMax", {
          title: "Maximum rating",
          value: this.values.ratingMax ?? [],
          items: STAR_OPTIONS,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as MGReadAdvancedSearchForm, "handleMax"),
        }),
        SelectRow("genres", {
          title: "Genres",
          subtitle: "Site filters apply when the search text is empty.",
          value: this.values.genres ?? [],
          items: this.genres,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: this.genres.length,
          onValueChange: Application.Selector(this as MGReadAdvancedSearchForm, "handleGenres"),
        }),
      ]),
    ];
  }
  async handleTypes(value: string[]): Promise<void> {
    this.values.types = value;
  }
  async handleStatus(value: string[]): Promise<void> {
    this.values.status = value;
  }
  async handleAge(value: string[]): Promise<void> {
    this.values.age = value;
  }
  async handleMin(value: string[]): Promise<void> {
    this.values.ratingMin = value;
  }
  async handleMax(value: string[]): Promise<void> {
    this.values.ratingMax = value;
  }
  async handleGenres(value: string[]): Promise<void> {
    this.values.genres = value;
  }
  override getSearchQueryMetadata(): SearchMetadata {
    return Object.fromEntries(
      Object.entries(this.values).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : Boolean(value),
      ),
    );
  }
}
