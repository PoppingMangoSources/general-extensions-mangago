/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  ToggleRow,
  TriStateSelectRow,
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
  type TriState,
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

  async handleGenresChange(value: TriState): Promise<void> {
    this.searchMetadata.genres = value;
  }

  async handleTagsChange(value: TriState): Promise<void> {
    this.searchMetadata.tags = value;
  }

  async handleTypesChange(value: TriState): Promise<void> {
    this.searchMetadata.types = value;
  }

  async handleStatusesChange(value: TriState): Promise<void> {
    this.searchMetadata.statuses = value;
  }

  async handleOriginsChange(value: TriState): Promise<void> {
    this.searchMetadata.origins = value;
  }

  async handleMinChaptersChange(value: string): Promise<void> {
    this.searchMetadata.minChapters = value.replace(/\D/g, "") || undefined;
  }

  async handleMaxChaptersChange(value: string): Promise<void> {
    this.searchMetadata.maxChapters = value.replace(/\D/g, "") || undefined;
  }
}
