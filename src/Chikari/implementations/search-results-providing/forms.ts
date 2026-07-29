/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import type {
  ChikariPreferences,
  Period,
  SeriesStatus,
  SeriesType,
  SortId,
} from "../shared/models";
import { STATUS_OPTIONS, TYPE_OPTIONS, type SearchMetadata, type TriState } from "./models";

export class ChikariAdvancedSearchForm extends AdvancedSearchForm {
  private genres: TriState;
  private minChapters: string;
  private readonly period?: Period;
  private readonly sort?: SortId;
  private statuses: SeriesStatus[];
  private tags: TriState;
  private types: SeriesType[];
  private year: string;

  constructor(
    searchQuery: SearchQuery<SearchMetadata>,
    preferences: ChikariPreferences,
    private readonly genreOptions: Tag[],
    private readonly tagOptions: Tag[],
  ) {
    super();
    const metadata = {
      genres: {},
      minChapters: "",
      statuses: [],
      tags: {},
      types: preferences.types,
      year: "",
      ...searchQuery.metadata,
    };
    this.genres = metadata.genres;
    this.minChapters = metadata.minChapters;
    this.period = metadata.period;
    this.sort = metadata.sort;
    this.statuses = metadata.statuses;
    this.tags = metadata.tags;
    this.types = metadata.types;
    this.year = metadata.year;
  }

  override getSections() {
    return [
      Section("series", [
        SelectRow("types", {
          title: "Types",
          layout: "flow",
          value: this.types,
          items: TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: TYPE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as ChikariAdvancedSearchForm,
            "handleTypesChange",
          ),
        }),
        SelectRow("statuses", {
          title: "Publishing status",
          layout: "flow",
          value: this.statuses,
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: STATUS_OPTIONS.length,
          onValueChange: Application.Selector(
            this as ChikariAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
        InputRow("year", {
          title: "Year",
          value: this.year,
          onValueChange: Application.Selector(
            this as ChikariAdvancedSearchForm,
            "handleYearChange",
          ),
        }),
        InputRow("min_chapters", {
          title: "Minimum chapters",
          value: this.minChapters,
          onValueChange: Application.Selector(
            this as ChikariAdvancedSearchForm,
            "handleMinChaptersChange",
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
            this as ChikariAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section({ id: "tags", footer: "The most-used tags are available." }, [
        TriStateSelectRow("tags", {
          title: "Tags",
          layout: "flow",
          value: this.tags,
          items: this.tagOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as ChikariAdvancedSearchForm,
            "handleTagsChange",
          ),
        }),
      ]),
    ];
  }

  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value as SeriesType[];
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value as SeriesStatus[];
  }

  async handleYearChange(value: string): Promise<void> {
    this.year = value.replace(/\D/g, "").slice(0, 4);
    this.reloadForm();
  }

  async handleMinChaptersChange(value: string): Promise<void> {
    this.minChapters = value.replace(/\D/g, "");
    this.reloadForm();
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleTagsChange(value: TriState): Promise<void> {
    this.tags = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (this.period) metadata.period = this.period;
    if (this.sort) metadata.sort = this.sort;
    if (this.types.length > 0) metadata.types = this.types;
    if (this.statuses.length > 0) metadata.statuses = this.statuses;
    if (this.year) metadata.year = this.year;
    if (this.minChapters) metadata.minChapters = this.minChapters;
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (Object.keys(this.tags).length > 0) metadata.tags = this.tags;
    return metadata;
  }
}
