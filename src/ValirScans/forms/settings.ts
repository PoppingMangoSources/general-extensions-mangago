/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, Section, ToggleRow } from "@paperback/types";

import { DOMAIN } from "../models";

const BASE_URL_KEY = "valirscans.baseUrl";

// setBaseUrl normalizes before every write, so a plain non-empty read suffices.
export const getBaseUrl = (): string => {
  const value = Application.getState(BASE_URL_KEY);
  return typeof value === "string" && value.length > 0 ? value : DOMAIN;
};

export const setBaseUrl = (value: string): void => {
  Application.setState(value.trim().replace(/\/+$/, ""), BASE_URL_KEY);
};

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
