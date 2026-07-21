/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, InputRow, LabelRow, Section, URL } from "@paperback/types";

import { MangaStreamSettings } from "./generic/forms";

const BASE_URL_KEY = "rokaricomics.baseUrlOverride";

export const getBaseUrlOverride = (): string | undefined => {
  const value = Application.getState(BASE_URL_KEY);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};

const setBaseUrlOverride = (value: string): string | undefined => {
  let trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    Application.setState("", BASE_URL_KEY);
    return "";
  }
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    new URL(trimmed).toString();
  } catch {
    return undefined;
  }
  Application.setState(trimmed, BASE_URL_KEY);
  return trimmed;
};

export class RokariComicsSettings extends MangaStreamSettings {
  private readonly defaultBaseUrl: string;
  private baseUrlOverride: string;

  constructor(name: string, defaultBaseUrl: string) {
    super(name);
    this.defaultBaseUrl = defaultBaseUrl;
    this.baseUrlOverride = getBaseUrlOverride() ?? "";
  }

  override getSections() {
    const effective =
      this.baseUrlOverride.trim().length > 0
        ? this.baseUrlOverride.trim().replace(/\/+$/, "")
        : this.defaultBaseUrl;

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if this source has moved to a new domain. " +
            `Leave empty to use the default. Include the scheme, e.g. ${this.defaultBaseUrl}`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.baseUrlOverride,
            onValueChange: Application.Selector(this as RokariComicsSettings, "updateOverride"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: effective }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector(this as RokariComicsSettings, "resetOverride"),
          }),
        ],
      ),
      ...super.getSections(),
    ];
  }

  async updateOverride(value: string): Promise<void> {
    const stored = setBaseUrlOverride(value);
    if (stored !== undefined) {
      this.baseUrlOverride = stored;
      Application.invalidateDiscoverSections();
    }
    this.reloadForm();
  }

  async resetOverride(): Promise<void> {
    this.baseUrlOverride = "";
    setBaseUrlOverride("");
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
