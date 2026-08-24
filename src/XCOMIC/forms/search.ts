/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  SelectSection,
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import {
  CHAPTER_COUNT_OPTIONS,
  FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  MODE_OPTIONS,
  STATUS_OPTIONS,
  type ContentPreferenceRating,
  type Demographic,
  type FilterOptions,
  type GenreMode,
  type SearchMetadata,
  type SeriesType,
  type TriState,
  type WorkStatus,
  type XComicPreferences,
} from "../models";

export class XComicAdvancedSearchForm extends AdvancedSearchForm {
  private chapCount: string;
  private contentRatings: ContentPreferenceRating[];
  private demographics: Demographic[];
  private excGenresMode: GenreMode[];
  private formats: TriState;
  private genres: TriState;
  private incGenresMode: GenreMode[];
  private originalLanguages: string[];
  private originalStatus: WorkStatus[];
  private translatedLanguages: string[];
  private types: SeriesType[];
  private uploadStatus: WorkStatus[];
  private year: string;

  constructor(
    searchQuery: SearchQuery<SearchMetadata>,
    preferences: XComicPreferences,
    private readonly filterOptions: FilterOptions,
  ) {
    super();
    const metadata = {
      chapCount: "",
      contentRatings: preferences.contentRatings,
      demographics: [],
      excGenresMode: "or" as GenreMode,
      formats: {},
      genres: {},
      incGenresMode: "and" as GenreMode,
      originalLanguages: [],
      originalStatus: [],
      translatedLanguages: ["en"],
      types: preferences.types,
      uploadStatus: [],
      year: "",
      ...searchQuery.metadata,
    };
    this.chapCount = metadata.chapCount;
    this.contentRatings = metadata.contentRatings;
    this.demographics = metadata.demographics;
    this.excGenresMode = [metadata.excGenresMode];
    this.formats = metadata.formats;
    this.genres = metadata.genres;
    this.incGenresMode = [metadata.incGenresMode];
    this.originalLanguages = metadata.originalLanguages;
    this.originalStatus = metadata.originalStatus;
    this.translatedLanguages = metadata.translatedLanguages;
    this.types = metadata.types;
    this.uploadStatus = metadata.uploadStatus;
    this.year = metadata.year;
  }

  override getSections() {
    return [
      Section("content", [
        SelectRow("types", {
          title: "Types",
          layout: "flow",
          value: this.types,
          items: this.filterOptions.types,
          minItemCount: 1,
          maxItemCount: this.filterOptions.types.length,
          onValueChange: Application.Selector(this as XComicAdvancedSearchForm, "handleTypes"),
        }),
        SelectRow("content_ratings", {
          title: "Content ratings",
          layout: "flow",
          value: this.contentRatings,
          items: this.filterOptions.contentRatings,
          minItemCount: 1,
          maxItemCount: this.filterOptions.contentRatings.length,
          onValueChange: Application.Selector(
            this as XComicAdvancedSearchForm,
            "handleContentRatings",
          ),
        }),
        SelectRow("demographics", {
          title: "Demographics",
          layout: "flow",
          value: this.demographics,
          items: this.filterOptions.demographics,
          minItemCount: 0,
          maxItemCount: this.filterOptions.demographics.length,
          onValueChange: Application.Selector(
            this as XComicAdvancedSearchForm,
            "handleDemographics",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.filterOptions.genres,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as XComicAdvancedSearchForm, "handleGenres"),
        }),
        TriStateSelectRow("formats", {
          title: "Formats",
          layout: "flow",
          value: this.formats,
          items: FORMAT_OPTIONS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as XComicAdvancedSearchForm, "handleFormats"),
        }),
      ]),
      SelectSection(this, {
        id: "include_mode",
        header: "Include mode",
        layout: "flow",
        value: this.incGenresMode,
        items: MODE_OPTIONS,
        minItemCount: 1,
        maxItemCount: 1,
      }),
      SelectSection(this, {
        id: "exclude_mode",
        header: "Exclude mode",
        layout: "flow",
        value: this.excGenresMode,
        items: MODE_OPTIONS,
        minItemCount: 1,
        maxItemCount: 1,
      }),
      Section("status", [
        SelectRow("original_status", {
          title: "Original work status",
          layout: "flow",
          value: this.originalStatus,
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as XComicAdvancedSearchForm,
            "handleOriginalStatus",
          ),
        }),
        SelectRow("upload_status", {
          title: "Upload status",
          layout: "flow",
          value: this.uploadStatus,
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as XComicAdvancedSearchForm,
            "handleUploadStatus",
          ),
        }),
        SelectRow("chapter_count", {
          title: "Chapter count",
          layout: "flow",
          value: [this.chapCount],
          items: CHAPTER_COUNT_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as XComicAdvancedSearchForm,
            "handleChapterCount",
          ),
        }),
        InputRow("year", {
          title: "Year or range",
          value: this.year,
          onValueChange: Application.Selector(this as XComicAdvancedSearchForm, "handleYear"),
        }),
      ]),
      Section("languages", [
        SelectRow("original_languages", {
          title: "Original languages",
          layout: "flow",
          value: this.originalLanguages,
          items: LANGUAGE_OPTIONS,
          minItemCount: 0,
          maxItemCount: LANGUAGE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as XComicAdvancedSearchForm,
            "handleOriginalLanguages",
          ),
        }),
        SelectRow("translated_languages", {
          title: "Translated languages",
          layout: "flow",
          value: this.translatedLanguages,
          items: LANGUAGE_OPTIONS,
          minItemCount: 0,
          maxItemCount: LANGUAGE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as XComicAdvancedSearchForm,
            "handleTranslatedLanguages",
          ),
        }),
      ]),
    ];
  }

  async handleTypes(value: string[]): Promise<void> {
    this.types = value as SeriesType[];
  }

  async handleContentRatings(value: string[]): Promise<void> {
    this.contentRatings = value as ContentPreferenceRating[];
  }

  async handleDemographics(value: string[]): Promise<void> {
    this.demographics = value as Demographic[];
  }

  async handleGenres(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleFormats(value: TriState): Promise<void> {
    this.formats = value;
  }

  async handleOriginalStatus(value: string[]): Promise<void> {
    this.originalStatus = value as WorkStatus[];
  }

  async handleUploadStatus(value: string[]): Promise<void> {
    this.uploadStatus = value as WorkStatus[];
  }

  async handleChapterCount(value: string[]): Promise<void> {
    this.chapCount = value[0] ?? "";
  }

  async handleYear(value: string): Promise<void> {
    this.year = value.replace(/[^\d-]/g, "").slice(0, 9);
    this.reloadForm();
  }

  async handleOriginalLanguages(value: string[]): Promise<void> {
    this.originalLanguages = value;
  }

  async handleTranslatedLanguages(value: string[]): Promise<void> {
    this.translatedLanguages = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (this.types.length) metadata.types = this.types;
    if (this.contentRatings.length) metadata.contentRatings = this.contentRatings;
    if (this.demographics.length) metadata.demographics = this.demographics;
    if (Object.keys(this.genres).length) metadata.genres = this.genres;
    if (Object.keys(this.formats).length) metadata.formats = this.formats;
    if (this.incGenresMode[0] !== "and") metadata.incGenresMode = this.incGenresMode[0];
    if (this.excGenresMode[0] !== "or") metadata.excGenresMode = this.excGenresMode[0];
    if (this.originalStatus.length) metadata.originalStatus = this.originalStatus;
    if (this.uploadStatus.length) metadata.uploadStatus = this.uploadStatus;
    if (this.chapCount) metadata.chapCount = this.chapCount;
    if (this.year) metadata.year = this.year;
    if (this.originalLanguages.length) metadata.originalLanguages = this.originalLanguages;
    if (this.translatedLanguages.length) metadata.translatedLanguages = this.translatedLanguages;
    return metadata;
  }
}
