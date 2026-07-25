/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, Section, ToggleRow, URL } from "@paperback/types";

import { DEFAULT_DOMAIN } from "../models";

const BASE_URL_KEY = "omanga_base_url";
const ALL_VERSIONS_KEY = "omanga_all_versions";

export const getDomain = (): string => {
  const value = Application.getState(BASE_URL_KEY);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return DEFAULT_DOMAIN;
};

export const setDomainOverride = (value: string): void => {
  Application.setState(value, BASE_URL_KEY);
};

export const getShowAllVersions = (): boolean =>
  (Application.getState(ALL_VERSIONS_KEY) as boolean | undefined) ?? true;

export const setShowAllVersions = (value: boolean): void => {
  Application.setState(value, ALL_VERSIONS_KEY);
};

const normalizeDomainInput = (value: string): string | undefined => {
  let trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return "";
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    new URL(trimmed).toString();
  } catch {
    return undefined;
  }
  return trimmed;
};

export class OMangaSettingsForm extends Form {
  private baseUrl: string;
  private allVersions: boolean;

  constructor() {
    super();
    const domain = getDomain();
    this.baseUrl = domain === DEFAULT_DOMAIN ? "" : domain;
    this.allVersions = getShowAllVersions();
  }

  override getSections() {
    return [
      Section(
        {
          id: "chapters",
          footer:
            "Show a separate chapter entry for every release team. Turn off to keep one entry " +
            "per chapter (the site's default upload).",
        },
        [
          ToggleRow("all_versions", {
            title: "All Scanlator Versions",
            value: this.allVersions,
            onValueChange: Application.Selector(this as OMangaSettingsForm, "updateAllVersions"),
          }),
        ],
      ),
      Section(
        {
          id: "base_url",
          footer:
            "Override the website address if oManga has moved. Leave empty for the default " +
            `(${DEFAULT_DOMAIN}). Include the scheme, e.g. https://omanga.to`,
        },
        [
          InputRow("base_url_input", {
            title: "Website URL",
            value: this.baseUrl,
            onValueChange: Application.Selector(this as OMangaSettingsForm, "updateBaseUrl"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: getDomain() }),
          ButtonRow("reset", {
            title: "Reset to defaults",
            onSelect: Application.Selector(this as OMangaSettingsForm, "resetSettings"),
          }),
        ],
      ),
    ];
  }

  async updateAllVersions(value: boolean): Promise<void> {
    this.allVersions = value;
    setShowAllVersions(value);
  }

  async updateBaseUrl(value: string): Promise<void> {
    const normalized = normalizeDomainInput(value);
    if (normalized !== undefined) {
      this.baseUrl = normalized;
      setDomainOverride(normalized);
      Application.invalidateDiscoverSections();
    }
    this.reloadForm();
  }

  async resetSettings(): Promise<void> {
    this.baseUrl = "";
    this.allVersions = true;
    setDomainOverride("");
    setShowAllVersions(true);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
