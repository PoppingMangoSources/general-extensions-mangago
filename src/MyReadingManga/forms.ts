/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { AdvancedSearchForm, Form, Section, SelectRow, type SearchQuery } from "@paperback/types";

import { LANGUAGES, type FilterOption, type FilterTaxonomies, type SearchMetadata } from "./models";

const LANGUAGES_KEY = "myreadingmanga.languages";

// Preferred language classes used to filter listing cards; empty means all.
export const getPreferredLanguages = (): string[] => {
  const value = Application.getState(LANGUAGES_KEY);
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
};

export class MyReadingMangaSettingsForm extends Form {
  private languages = getPreferredLanguages();

  async updateLanguages(value: string[]): Promise<void> {
    this.languages = value;
    Application.setState(value, LANGUAGES_KEY);
  }

  override getSections() {
    return [
      Section(
        {
          id: "languages",
          footer:
            "Only show entries in the selected languages in Discover sections. Leave empty to show every language.",
        },
        [
          SelectRow("languages", {
            title: "Languages",
            layout: "flow",
            value: this.languages,
            items: LANGUAGES.map((language) => ({ id: language.class, title: language.name })),
            minItemCount: 0,
            maxItemCount: LANGUAGES.length,
            onValueChange: Application.Selector(
              this as MyReadingMangaSettingsForm,
              "updateLanguages",
            ),
          }),
        ],
      ),
    ];
  }
}

export class MyReadingMangaAdvancedSearchForm extends AdvancedSearchForm {
  private searchMetadata: SearchMetadata;

  constructor(
    searchQuery: SearchQuery<SearchMetadata>,
    private readonly taxonomies: FilterTaxonomies,
  ) {
    super();
    this.searchMetadata = searchQuery.metadata ?? {};
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return this.searchMetadata;
  }

  private selectSection(
    id: "genre" | "category" | "tag" | "artist" | "pairing" | "status" | "language",
    title: string,
    items: FilterOption[],
    handler:
      | "handleGenreChange"
      | "handleCategoryChange"
      | "handleTagChange"
      | "handleArtistChange"
      | "handlePairingChange"
      | "handleStatusChange"
      | "handleLanguageChange",
  ) {
    return Section(id, [
      SelectRow(id, {
        title,
        layout: "flow",
        value: this.searchMetadata[id] ? [this.searchMetadata[id]] : [],
        items,
        minItemCount: 0,
        maxItemCount: 1,
        onValueChange: Application.Selector(this as MyReadingMangaAdvancedSearchForm, handler),
      }),
    ]);
  }

  override getSections() {
    const languages = LANGUAGES.map((language) => ({ id: language.code, title: language.name }));
    const sections = [
      this.selectSection("language", "Language", languages, "handleLanguageChange"),
    ];

    const taxonomySections = [
      ["genre", "Genre", "handleGenreChange"],
      ["category", "Category", "handleCategoryChange"],
      ["tag", "Tag", "handleTagChange"],
      ["artist", "Circle / Artist", "handleArtistChange"],
      ["pairing", "Pairing", "handlePairingChange"],
      ["status", "Status", "handleStatusChange"],
    ] as const;
    for (const [id, title, handler] of taxonomySections) {
      const options = this.taxonomies[id] ?? [];
      if (options.length > 0) sections.push(this.selectSection(id, title, options, handler));
    }
    return sections;
  }

  async handleLanguageChange(value: string[]): Promise<void> {
    this.searchMetadata.language = value[0] || undefined;
  }

  async handleGenreChange(value: string[]): Promise<void> {
    this.searchMetadata.genre = value[0] || undefined;
  }

  async handleCategoryChange(value: string[]): Promise<void> {
    this.searchMetadata.category = value[0] || undefined;
  }

  async handleTagChange(value: string[]): Promise<void> {
    this.searchMetadata.tag = value[0] || undefined;
  }

  async handleArtistChange(value: string[]): Promise<void> {
    this.searchMetadata.artist = value[0] || undefined;
  }

  async handlePairingChange(value: string[]): Promise<void> {
    this.searchMetadata.pairing = value[0] || undefined;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.searchMetadata.status = value[0] || undefined;
  }
}
