/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  InputRow,
  Section,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { DOMAIN, GENRES, type SearchMetadata } from "./models";

const BASE_URL_KEY = "mangaberri.baseUrl";

export const getBaseUrl = (): string =>
  (Application.getState(BASE_URL_KEY) as string | undefined) ?? DOMAIN;

const setBaseUrl = (value: string): void => {
  const trimmed = value.trim().replace(/\/+$/, "");
  Application.setState(/^https?:\/\/[^\s/]+$/.test(trimmed) ? trimmed : undefined, BASE_URL_KEY);
  Application.invalidateDiscoverSections();
};

export class MangaBerriSettingsForm extends Form {
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
              this as MangaBerriSettingsForm,
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

export class MangaBerriAdvancedSearchForm extends AdvancedSearchForm {
  private genres: Record<string, "included" | "excluded">;

  private readonly genreOptions: Tag[] = GENRES.map((genre) => ({
    id: genre.id,
    title: genre.value,
  }));

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    this.genres = { ...searchQuery.metadata?.genres };
  }

  override getSections() {
    return [
      Section({ id: "genres", footer: "The site browses one genre at a time." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: false,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as MangaBerriAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    return result;
  }
}
