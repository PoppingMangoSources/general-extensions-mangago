/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, Section } from "@paperback/types";

const BASE_URL_KEY = "vymanga.baseUrlOverride";

// This site rotates domains (vymanga.com / vyvymanga.net); let readers point at
// the current one without waiting for an extension update.
export function getBaseUrlOverride(): string | undefined {
  const value = Application.getState(BASE_URL_KEY);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function setBaseUrlOverride(value: string): void {
  Application.setState(value.trim().replace(/\/+$/, ""), BASE_URL_KEY);
}

export class VyMangaSettingsForm extends Form {
  private override: string;

  constructor(private readonly defaultBaseUrl: string) {
    super();
    this.override = getBaseUrlOverride() ?? "";
  }

  async updateOverride(value: string): Promise<void> {
    this.override = value;
    setBaseUrlOverride(value);
    this.reloadForm();
  }

  async resetOverride(): Promise<void> {
    this.override = "";
    setBaseUrlOverride("");
    this.reloadForm();
  }

  override getSections() {
    const effective =
      this.override.trim().length > 0
        ? this.override.trim().replace(/\/+$/, "")
        : this.defaultBaseUrl;

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if this source has moved to a new domain. " +
            `Leave empty to use the default (${this.defaultBaseUrl}). Include the scheme — ` +
            "the mirror https://vymanga.net also works.",
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.override,
            onValueChange: Application.Selector(this as VyMangaSettingsForm, "updateOverride"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: effective }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector(this as VyMangaSettingsForm, "resetOverride"),
          }),
        ],
      ),
    ];
  }
}
