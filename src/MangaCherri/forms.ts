/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  InputRow,
  Section,
  SelectRow,
  type SearchQuery,
} from "@paperback/types";

import { DOMAIN, GENRES, STATUS_OPTIONS, type SearchMetadata } from "./models";

const BASE_URL_KEY = "mangacherri.baseUrl";

export const getBaseUrl = (): string =>
  (Application.getState(BASE_URL_KEY) as string | undefined) ?? DOMAIN;

const setBaseUrl = (value: string): void => {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(/^https?:\/\/[^\s/]+$/.test(trimmed) ? trimmed : undefined, BASE_URL_KEY);
  Application.invalidateDiscoverSections();
};

export class MangaCherriSettingsForm extends Form {
  private baseUrl = getBaseUrl();

  override getSections() {
    return [
      Section(
        {
          id: "domain",
          footer: `Override the site address if it moves. Leave empty to use ${DOMAIN}.`,
        },
        [
          InputRow("base_url", {
            title: "Base URL",
            value: this.baseUrl === DOMAIN ? "" : this.baseUrl,
            onValueChange: Application.Selector(
              this as MangaCherriSettingsForm,
              "handleBaseUrlChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleBaseUrlChange(value: string): Promise<void> {
    this.baseUrl = value;
    setBaseUrl(value);
  }
}

// The catalogue filters on one genre and one status at a time, as its own form does.
export class MangaCherriAdvancedSearchForm extends AdvancedSearchForm {
  private genre: string | undefined;
  private status: string | undefined;

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    this.genre = searchQuery.metadata?.genre;
    this.status = searchQuery.metadata?.status;
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("genre", {
          title: "Genre",
          layout: "flow",
          value: this.genre ? [this.genre] : [],
          items: GENRES,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaCherriAdvancedSearchForm,
            "handleGenreChange",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status ? [this.status] : [],
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaCherriAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenreChange(value: string[]): Promise<void> {
    this.genre = value[0];
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value[0];
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      ...(this.genre ? { genre: this.genre } : {}),
      ...(this.status ? { status: this.status } : {}),
    };
  }
}
