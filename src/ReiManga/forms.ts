/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  InputRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { DOMAIN, GENRES, STATUS_OPTIONS, type SearchMetadata } from "./models";

const BASE_URL_KEY = "reimanga.baseUrl";
const PREVIOUS_DOMAIN = "https://reimanga.com";

export const getBaseUrl = (): string => {
  const stored = Application.getState(BASE_URL_KEY) as string | undefined;
  return !stored || stored === PREVIOUS_DOMAIN ? DOMAIN : stored;
};

export const setBaseUrl = (value: string): void => {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(/^https?:\/\/[^\s/]+$/.test(trimmed) ? trimmed : undefined, BASE_URL_KEY);
  Application.invalidateDiscoverSections();
};

export class ReiMangaSettingsForm extends Form {
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
              this as ReiMangaSettingsForm,
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

export class ReiMangaAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private genres: Record<string, "included" | "excluded">;

  private readonly statusOptions: Tag[] = STATUS_OPTIONS;
  private readonly genreOptions: Tag[] = GENRES;

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.status = meta.status ?? [];
    this.genres = { ...meta.genres };
  }

  override getSections() {
    return [
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ReiMangaAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as ReiMangaAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
    ];
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.status.length > 0) result.status = this.status;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    return result;
  }
}
