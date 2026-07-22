/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  Section,
  SelectRow,
  ToggleRow,
  type SearchQuery,
} from "@paperback/types";

import { STATUS_OPTIONS, type SearchMetadata } from "./models";

const SHOW_PAID_CHAPTERS_KEY = "templescan.showPaidChapters";

export const getShowPaidChapters = (): boolean =>
  Application.getState(SHOW_PAID_CHAPTERS_KEY) === true;

export class TempleScanSettingsForm extends Form {
  private showPaidChapters = getShowPaidChapters();

  async updateShowPaidChapters(value: boolean): Promise<void> {
    this.showPaidChapters = value;
    Application.setState(value, SHOW_PAID_CHAPTERS_KEY);
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
              this as TempleScanSettingsForm,
              "updateShowPaidChapters",
            ),
          }),
        ],
      ),
    ];
  }
}

export class TempleScanAdvancedSearchForm extends AdvancedSearchForm {
  private searchMetadata: SearchMetadata;

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    this.searchMetadata = searchQuery.metadata ?? {};
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return this.searchMetadata;
  }

  override getSections() {
    return [
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: [this.searchMetadata.status ?? ""],
          items: STATUS_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as TempleScanAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
    ];
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.searchMetadata.status = value[0] || undefined;
  }
}
