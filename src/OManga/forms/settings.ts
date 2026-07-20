/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, Section, ToggleRow, URL } from "@paperback/types";

import {
  DEFAULT_DOMAIN,
  getDomain,
  getShowAllVersions,
  setDomainOverride,
  setShowAllVersions,
} from "../models";

// Normalise before persisting: a scheme-less or malformed value would make
// every request URL invalid and brick the source. Empty clears the override;
// undefined signals the input couldn't be parsed and should be ignored.
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
