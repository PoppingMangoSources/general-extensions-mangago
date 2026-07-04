/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  ORDER_OPTIONS,
  SEARCH_TYPE_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  type OptionItem,
  type SearchMetadata,
} from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

export class VyMangaSearchForm extends AdvancedSearchForm {
  private author: string;
  private searchType: string[];
  private searchDescription: boolean;
  private status: string[];
  private sort: string[];
  private order: string[];
  private genres: Record<string, "included" | "excluded">;

  private readonly searchTypeOptions = toTags(SEARCH_TYPE_OPTIONS);
  private readonly statusOptions = toTags(STATUS_OPTIONS);
  private readonly sortOptions = toTags(SORT_OPTIONS);
  private readonly orderOptions = toTags(ORDER_OPTIONS);
  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genres: OptionItem[]) {
    super();
    this.genreOptions = toTags(genres);

    const meta = searchQuery.metadata ?? {};
    this.author = meta.author ?? "";
    this.searchType = meta.searchType ?? [];
    this.searchDescription = meta.searchDescription ?? false;
    this.status = meta.status ?? [];
    this.sort = meta.sort ?? [];
    this.order = meta.order ?? [];
    this.genres = { ...meta.genres };
  }

  override getSections() {
    const sections = [
      Section("title_options", [
        SelectRow("searchType", {
          title: "Title match",
          layout: "flow",
          value: this.searchType,
          items: this.searchTypeOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as VyMangaSearchForm, "handleSearchTypeChange"),
        }),
        ToggleRow("searchDescription", {
          title: "Also search descriptions",
          value: this.searchDescription,
          onValueChange: Application.Selector(
            this as VyMangaSearchForm,
            "handleSearchDescriptionChange",
          ),
        }),
      ]),
      Section("author", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(this as VyMangaSearchForm, "handleAuthorChange"),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as VyMangaSearchForm, "handleStatusChange"),
        }),
      ]),
      Section("sort", [
        SelectRow("sort", {
          title: "Sort by",
          layout: "flow",
          value: this.sort,
          items: this.sortOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as VyMangaSearchForm, "handleSortChange"),
        }),
        SelectRow("order", {
          title: "Order",
          layout: "flow",
          value: this.order,
          items: this.orderOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as VyMangaSearchForm, "handleOrderChange"),
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
            onValueChange: Application.Selector(this as VyMangaSearchForm, "handleGenresChange"),
          }),
        ]),
      );
    }

    return sections;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleSearchTypeChange(value: string[]): Promise<void> {
    this.searchType = value;
  }

  async handleSearchDescriptionChange(value: boolean): Promise<void> {
    this.searchDescription = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleSortChange(value: string[]): Promise<void> {
    this.sort = value;
  }

  async handleOrderChange(value: string[]): Promise<void> {
    this.order = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.author.trim()) result.author = this.author.trim();
    if (this.searchType.length > 0) result.searchType = this.searchType;
    if (this.searchDescription) result.searchDescription = true;
    if (this.status.length > 0) result.status = this.status;
    if (this.sort.length > 0) result.sort = this.sort;
    if (this.order.length > 0) result.order = this.order;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    return result;
  }
}
