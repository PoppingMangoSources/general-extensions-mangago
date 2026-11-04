/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  InputRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { CONTENT_OPTIONS, type SearchMetadata } from "../models";
export class SwarmAdvancedSearchForm extends AdvancedSearchForm {
  private values: SearchMetadata;
  constructor(
    query: SearchQuery<SearchMetadata>,
    private readonly genres: Tag[],
    private readonly types: Tag[],
    private readonly tags: Tag[],
  ) {
    super();
    this.values = { ...query.metadata };
  }
  override getSections() {
    const catalog = Section("catalog", [
      SelectRow("catalog", {
        title: "Catalog",
        value: this.values.catalog ?? ["comics"],
        items: [
          { id: "comics", title: "Comics" },
          { id: "novels", title: "Novels" },
        ],
        layout: "flow",
        minItemCount: 1,
        maxItemCount: 1,
        onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleCatalog"),
      }),
    ]);
    if (this.values.catalog?.[0] === "novels") return [catalog];
    return [
      catalog,
      Section("filters", [
        SelectRow("content", {
          title: "Content rating",
          value: this.values.content ?? [],
          items: CONTENT_OPTIONS,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleContent"),
        }),
        SelectRow("genres", {
          title: "Genres",
          value: this.values.genres ?? [],
          items: this.genres,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: this.genres.length,
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleGenres"),
        }),
        SelectRow("types", {
          title: "Types",
          value: this.values.types ?? [],
          items: this.types,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: this.types.length,
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleTypes"),
        }),
        SelectRow("tags", {
          title: "Tags",
          value: this.values.tags ?? [],
          items: this.tags,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: this.tags.length,
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleTags"),
        }),
        InputRow("yearStartMin", {
          title: "Started from year",
          value: this.values.yearStartMin ?? "",
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleStartMin"),
        }),
        InputRow("yearStartMax", {
          title: "Started up to year",
          value: this.values.yearStartMax ?? "",
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleStartMax"),
        }),
        InputRow("yearEndedMin", {
          title: "Ended from year",
          value: this.values.yearEndedMin ?? "",
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleEndMin"),
        }),
        InputRow("yearEndedMax", {
          title: "Ended up to year",
          value: this.values.yearEndedMax ?? "",
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleEndMax"),
        }),
        InputRow("minChapters", {
          title: "Minimum chapters",
          value: this.values.minChapters ?? "",
          onValueChange: Application.Selector(this as SwarmAdvancedSearchForm, "handleChapters"),
        }),
      ]),
    ];
  }
  async handleCatalog(value: string[]): Promise<void> {
    this.values.catalog = value;
    this.reloadForm();
  }
  async handleContent(value: string[]): Promise<void> {
    this.values.content = value;
  }
  async handleGenres(value: string[]): Promise<void> {
    this.values.genres = value;
  }
  async handleTypes(value: string[]): Promise<void> {
    this.values.types = value;
  }
  async handleTags(value: string[]): Promise<void> {
    this.values.tags = value;
  }
  async handleStartMin(value: string): Promise<void> {
    this.values.yearStartMin = value.trim();
  }
  async handleStartMax(value: string): Promise<void> {
    this.values.yearStartMax = value.trim();
  }
  async handleEndMin(value: string): Promise<void> {
    this.values.yearEndedMin = value.trim();
  }
  async handleEndMax(value: string): Promise<void> {
    this.values.yearEndedMax = value.trim();
  }
  async handleChapters(value: string): Promise<void> {
    this.values.minChapters = value.trim();
  }
  override getSearchQueryMetadata(): SearchMetadata {
    if (this.values.catalog?.[0] === "novels") return { catalog: ["novels"] };
    return Object.fromEntries(
      Object.entries(this.values).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : Boolean(value),
      ),
    );
  }
}
