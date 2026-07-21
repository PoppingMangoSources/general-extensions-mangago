/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, Section, SelectRow, URL } from "@paperback/types";

import {
  API_URL_KEY,
  BASE_URL_KEY,
  CONTENT_PREFERENCE_KEY,
  DEFAULT_API_URL,
  DEFAULT_DOMAIN,
  HIDDEN_GENRES_KEY,
  TAG_OPTIONS,
} from "../models";

export type ContentPreference = "safe" | "all";

const CONTENT_PREFERENCE_OPTIONS = [
  { id: "safe", title: "SFW" },
  { id: "all", title: "All Content" },
];

const GENRE_OPTIONS = TAG_OPTIONS.map((tag) => ({ id: tag.id, title: tag.value }));
const VALID_GENRE_IDS = new Set(TAG_OPTIONS.map((tag) => tag.id));

const readOverride = (key: string): string | undefined => {
  const value = Application.getState(key);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};
export const getDomain = (): string => {
  return readOverride(BASE_URL_KEY) ?? DEFAULT_DOMAIN;
};
export const getApiUrl = (): string => {
  return readOverride(API_URL_KEY) ?? DEFAULT_API_URL;
};
export const getContentPreference = (): ContentPreference => {
  return Application.getState(CONTENT_PREFERENCE_KEY) === "all" ? "all" : "safe";
};
export const getHiddenGenreIds = (): string[] => {
  const value = Application.getState(HIDDEN_GENRES_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string" && VALID_GENRE_IDS.has(id));
};

const setOverride = (key: string, value: string): string | undefined => {
  let trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    Application.setState("", key);
    return "";
  }
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    new URL(trimmed).toString();
  } catch {
    return undefined;
  }
  Application.setState(trimmed, key);
  return trimmed;
};

export class ScansGGSettingsForm extends Form {
  private baseUrl: string;
  private apiUrl: string;
  private contentPreference: ContentPreference;
  private hiddenGenreIds: string[];

  constructor() {
    super();
    this.baseUrl = readOverride(BASE_URL_KEY) ?? "";
    this.apiUrl = readOverride(API_URL_KEY) ?? "";
    this.contentPreference = getContentPreference();
    this.hiddenGenreIds = getHiddenGenreIds();
  }

  override getSections() {
    return [
      Section(
        {
          id: "content",
          header: "Content Preference",
          footer:
            "SFW shows only titles rated safe. All Content allows every rating. " +
            "Selected genres are always hidden from discover and search.",
        },
        [
          SelectRow("content_preference", {
            title: "Content Rating",
            layout: "list",
            value: [this.contentPreference],
            items: CONTENT_PREFERENCE_OPTIONS,
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(
              this as ScansGGSettingsForm,
              "updateContentPreference",
            ),
          }),
          SelectRow("hidden_genres", {
            title: "Hide Genres",
            subtitle: "Exclude selected genres from discover and search",
            layout: "list",
            value: this.hiddenGenreIds,
            items: GENRE_OPTIONS,
            minItemCount: 0,
            maxItemCount: GENRE_OPTIONS.length,
            onValueChange: Application.Selector(this as ScansGGSettingsForm, "updateHiddenGenres"),
          }),
        ],
      ),
      Section(
        {
          id: "base_url",
          footer:
            "Override the website address if Scans.GG has moved. Leave empty for the default " +
            `(${DEFAULT_DOMAIN}). Include the scheme, e.g. https://scans.gg`,
        },
        [
          InputRow("base_url_input", {
            title: "Website URL",
            value: this.baseUrl,
            onValueChange: Application.Selector(this as ScansGGSettingsForm, "updateBaseUrl"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: getDomain() }),
        ],
      ),
      Section(
        {
          id: "api_url",
          footer:
            "Override the API address only if the default stops responding. Leave empty for the " +
            `default (${DEFAULT_API_URL}).`,
        },
        [
          InputRow("api_url_input", {
            title: "API URL",
            value: this.apiUrl,
            onValueChange: Application.Selector(this as ScansGGSettingsForm, "updateApiUrl"),
          }),
          LabelRow("api_url_current", { title: "Currently using", value: getApiUrl() }),
          ButtonRow("reset", {
            title: "Reset to defaults",
            onSelect: Application.Selector(this as ScansGGSettingsForm, "resetOverrides"),
          }),
        ],
      ),
    ];
  }

  async updateBaseUrl(value: string): Promise<void> {
    const stored = setOverride(BASE_URL_KEY, value);
    if (stored !== undefined) {
      this.baseUrl = stored;
      Application.invalidateDiscoverSections();
    }
    this.reloadForm();
  }

  async updateApiUrl(value: string): Promise<void> {
    const stored = setOverride(API_URL_KEY, value);
    if (stored !== undefined) {
      this.apiUrl = stored;
      Application.invalidateDiscoverSections();
    }
    this.reloadForm();
  }

  async updateContentPreference(value: string[]): Promise<void> {
    this.contentPreference = value[0] === "all" ? "all" : "safe";
    Application.setState(this.contentPreference, CONTENT_PREFERENCE_KEY);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async updateHiddenGenres(value: string[]): Promise<void> {
    this.hiddenGenreIds = value.filter((id) => VALID_GENRE_IDS.has(id));
    Application.setState(this.hiddenGenreIds, HIDDEN_GENRES_KEY);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async resetOverrides(): Promise<void> {
    this.baseUrl = "";
    this.apiUrl = "";
    setOverride(BASE_URL_KEY, "");
    setOverride(API_URL_KEY, "");
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
