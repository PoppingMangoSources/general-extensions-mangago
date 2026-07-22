/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  type SearchQuery,
} from "@paperback/types";

import {
  DOMAIN,
  getBaseUrl,
  ORIGIN_OPTIONS,
  setBaseUrl,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type FilterOption,
  type SearchMetadata,
} from "./models";

const SHOW_PAID_CHAPTERS_KEY = "valirscans.showPaidChapters";

export const getShowPaidChapters = (): boolean =>
  Application.getState(SHOW_PAID_CHAPTERS_KEY) === true;

export class ValirScansSettingsForm extends Form {
  private showPaidChapters = getShowPaidChapters();
  private baseUrlOverride = getBaseUrl();

  async updateShowPaidChapters(value: boolean): Promise<void> {
    this.showPaidChapters = value;
    Application.setState(value, SHOW_PAID_CHAPTERS_KEY);
  }

  async updateBaseUrl(value: string): Promise<void> {
    this.baseUrlOverride = value;
    setBaseUrl(value);
    this.reloadForm();
  }

  async resetBaseUrl(): Promise<void> {
    this.baseUrlOverride = DOMAIN;
    setBaseUrl("");
    this.reloadForm();
  }

  override getSections() {
    return [
      Section(
        {
          id: "chapters",
          footer: "Paid chapters are marked with a lock and need to be unlocked on the website.",
        },
        [
          ToggleRow("show_paid_chapters", {
            title: "Show Paid Chapters",
            value: this.showPaidChapters,
            onValueChange: Application.Selector(
              this as ValirScansSettingsForm,
              "updateShowPaidChapters",
            ),
          }),
        ],
      ),
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if it moves to a new domain. " +
            `Leave empty to use the default (${DOMAIN}). Include the scheme.`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.baseUrlOverride === DOMAIN ? "" : this.baseUrlOverride,
            onValueChange: Application.Selector(this as ValirScansSettingsForm, "updateBaseUrl"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: getBaseUrl() }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector(this as ValirScansSettingsForm, "resetBaseUrl"),
          }),
        ],
      ),
    ];
  }
}

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

  override getSections() {
    return [
      Section("genres", [
        SelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.searchMetadata.genres ?? [],
          items: this.genres,
          minItemCount: 0,
          maxItemCount: this.genres.length,
          onValueChange: Application.Selector(
            this as ValirScansAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section("tags", [
        SelectRow("tags", {
          title: "Tags",
          layout: "flow",
          value: this.searchMetadata.tags ?? [],
          items: this.tags,
          minItemCount: 0,
          maxItemCount: this.tags.length,
          onValueChange: Application.Selector(
            this as ValirScansAdvancedSearchForm,
            "handleTagsChange",
          ),
        }),
      ]),
      Section("type", [
        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: [this.searchMetadata.type ?? ""],
          items: TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ValirScansAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: [this.searchMetadata.status ?? ""],
          items: STATUS_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ValirScansAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("origin", [
        SelectRow("origin", {
          title: "Origin",
          layout: "list",
          value: [this.searchMetadata.origin ?? ""],
          items: ORIGIN_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ValirScansAdvancedSearchForm,
            "handleOriginChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.searchMetadata.genres = value;
  }

  async handleTagsChange(value: string[]): Promise<void> {
    this.searchMetadata.tags = value;
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.searchMetadata.type = value[0] || undefined;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.searchMetadata.status = value[0] || undefined;
  }

  async handleOriginChange(value: string[]): Promise<void> {
    this.searchMetadata.origin = value[0] || undefined;
  }
}
