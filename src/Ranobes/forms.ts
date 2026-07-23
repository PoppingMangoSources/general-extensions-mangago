/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type FormSectionElement,
  type SearchQuery,
} from "@paperback/types";

import {
  LANGUAGE_OPTIONS,
  ORIGINAL_STATUS_OPTIONS,
  TRANSLATION_STATUS_OPTIONS,
  type FilterTaxonomy,
  type SearchMetadata,
} from "./models";

export class RanobesAdvancedSearchForm extends AdvancedSearchForm {
  private searchMetadata: SearchMetadata;

  constructor(
    searchQuery: SearchQuery<SearchMetadata>,
    private readonly taxonomy: FilterTaxonomy,
  ) {
    super();
    this.searchMetadata = searchQuery.metadata ?? {};
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return this.searchMetadata;
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.searchMetadata.genres ?? {},
          items: this.taxonomy.genres,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section({ id: "events", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("events", {
          title: "Tags (Events)",
          layout: "list",
          value: this.searchMetadata.events ?? {},
          items: this.taxonomy.events,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleEventsChange",
          ),
        }),
      ]),
      Section("years", [
        InputRow("year_from", {
          title: "Year of Release From",
          value: this.searchMetadata.yearFrom ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleYearFromChange",
          ),
        }),
        InputRow("year_to", {
          title: "Year of Release Up To",
          value: this.searchMetadata.yearTo ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleYearToChange",
          ),
        }),
      ]),
      Section({ id: "languages", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("languages", {
          title: "Languages",
          layout: "flow",
          value: this.searchMetadata.languages ?? {},
          items: LANGUAGE_OPTIONS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleLanguagesChange",
          ),
        }),
      ]),
      Section("statuses", [
        SelectRow("translation_status", {
          title: "Translate Status",
          layout: "list",
          value: [this.searchMetadata.translationStatus ?? "any"],
          items: TRANSLATION_STATUS_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleTranslationStatusChange",
          ),
        }),
        SelectRow("original_status", {
          title: "Status in COO",
          layout: "list",
          value: [this.searchMetadata.originalStatus ?? "any"],
          items: ORIGINAL_STATUS_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleOriginalStatusChange",
          ),
        }),
      ]),
      Section("chapter_count", [
        InputRow("chapters_from", {
          title: "Minimum Chapters",
          value: this.searchMetadata.chaptersFrom ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleChaptersFromChange",
          ),
        }),
        InputRow("chapters_to", {
          title: "Maximum Chapters",
          value: this.searchMetadata.chaptersTo ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleChaptersToChange",
          ),
        }),
      ]),
      Section("rating_count", [
        InputRow("ratings_from", {
          title: "Minimum Number of Ratings",
          value: this.searchMetadata.ratingsFrom ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleRatingsFromChange",
          ),
        }),
        InputRow("ratings_to", {
          title: "Maximum Number of Ratings",
          value: this.searchMetadata.ratingsTo ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleRatingsToChange",
          ),
        }),
      ]),
      Section("authors", [
        InputRow("authors", {
          title: "Authors",
          value: this.searchMetadata.authors ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleAuthorsChange",
          ),
        }),
        InputRow("excluded_authors", {
          title: "Exclude Authors",
          value: this.searchMetadata.excludedAuthors ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleExcludedAuthorsChange",
          ),
        }),
      ]),
      Section("translators", [
        InputRow("translators", {
          title: "Translators",
          value: this.searchMetadata.translators ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleTranslatorsChange",
          ),
        }),
        InputRow("excluded_translators", {
          title: "Exclude Translators",
          value: this.searchMetadata.excludedTranslators ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleExcludedTranslatorsChange",
          ),
        }),
      ]),
      Section("publishers", [
        InputRow("publishers", {
          title: "Publishers",
          value: this.searchMetadata.publishers ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handlePublishersChange",
          ),
        }),
        InputRow("excluded_publishers", {
          title: "Exclude Publishers",
          value: this.searchMetadata.excludedPublishers ?? "",
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleExcludedPublishersChange",
          ),
        }),
      ]),
      Section("translation_types", [
        ToggleRow("only_translated", {
          title: "Only TL",
          value: this.searchMetadata.onlyTranslated ?? false,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleOnlyTranslatedChange",
          ),
        }),
        ToggleRow("mtl_files", {
          title: "MTL Files",
          value: this.searchMetadata.mtlFiles ?? false,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleMtlFilesChange",
          ),
        }),
        ToggleRow("mtl_reader", {
          title: "MTL Reader",
          value: this.searchMetadata.mtlReader ?? false,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleMtlReaderChange",
          ),
        }),
        ToggleRow("ai_translated", {
          title: "AI-Based MTL",
          value: this.searchMetadata.aiTranslated ?? false,
          onValueChange: Application.Selector(
            this as RanobesAdvancedSearchForm,
            "handleAiTranslatedChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.searchMetadata.genres = value;
  }

  async handleEventsChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.searchMetadata.events = value;
  }

  async handleLanguagesChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.searchMetadata.languages = value;
  }

  async handleTranslationStatusChange(value: string[]): Promise<void> {
    this.searchMetadata.translationStatus = value[0] || "any";
  }

  async handleOriginalStatusChange(value: string[]): Promise<void> {
    this.searchMetadata.originalStatus = value[0] || "any";
  }

  async handleYearFromChange(value: string): Promise<void> {
    this.searchMetadata.yearFrom = value.replace(/\D/g, "") || undefined;
  }

  async handleYearToChange(value: string): Promise<void> {
    this.searchMetadata.yearTo = value.replace(/\D/g, "") || undefined;
  }

  async handleChaptersFromChange(value: string): Promise<void> {
    this.searchMetadata.chaptersFrom = value.replace(/\D/g, "") || undefined;
  }

  async handleChaptersToChange(value: string): Promise<void> {
    this.searchMetadata.chaptersTo = value.replace(/\D/g, "") || undefined;
  }

  async handleRatingsFromChange(value: string): Promise<void> {
    this.searchMetadata.ratingsFrom = value.replace(/\D/g, "") || undefined;
  }

  async handleRatingsToChange(value: string): Promise<void> {
    this.searchMetadata.ratingsTo = value.replace(/\D/g, "") || undefined;
  }

  async handleAuthorsChange(value: string): Promise<void> {
    this.searchMetadata.authors = value.trim() || undefined;
  }

  async handleExcludedAuthorsChange(value: string): Promise<void> {
    this.searchMetadata.excludedAuthors = value.trim() || undefined;
  }

  async handleTranslatorsChange(value: string): Promise<void> {
    this.searchMetadata.translators = value.trim() || undefined;
  }

  async handleExcludedTranslatorsChange(value: string): Promise<void> {
    this.searchMetadata.excludedTranslators = value.trim() || undefined;
  }

  async handlePublishersChange(value: string): Promise<void> {
    this.searchMetadata.publishers = value.trim() || undefined;
  }

  async handleExcludedPublishersChange(value: string): Promise<void> {
    this.searchMetadata.excludedPublishers = value.trim() || undefined;
  }

  async handleOnlyTranslatedChange(value: boolean): Promise<void> {
    this.searchMetadata.onlyTranslated = value;
  }

  async handleMtlFilesChange(value: boolean): Promise<void> {
    this.searchMetadata.mtlFiles = value;
  }

  async handleMtlReaderChange(value: boolean): Promise<void> {
    this.searchMetadata.mtlReader = value;
  }

  async handleAiTranslatedChange(value: boolean): Promise<void> {
    this.searchMetadata.aiTranslated = value;
  }
}
