/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, SelectRow } from "@paperback/types";

import {
  CONTENT_RATING_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  DEFAULT_CONTENT_TYPES,
  DEFAULT_LANGUAGES,
  FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  SECTION_IDS,
  SECTION_OPTIONS,
  STATE_KEYS,
  type ContentPreferenceRating,
  type FilterOptions,
  type SectionId,
  type SeriesType,
  type XComicPreferences,
} from "../models";

export const getPreferences = (): XComicPreferences => {
  const validRatings = new Set(CONTENT_RATING_OPTIONS.map((option) => option.id));
  const storedRatings =
    (Application.getState(STATE_KEYS.CONTENT_RATINGS) as ContentPreferenceRating[] | undefined) ??
    [];
  const ratings = storedRatings.filter((rating) => validRatings.has(rating));

  // Types come from the site's own filter list, so any stored id is accepted as-is.
  const types = (Application.getState(STATE_KEYS.CONTENT_TYPES) as SeriesType[] | undefined) ?? [];

  const languages = (Application.getState(STATE_KEYS.LANGUAGES) as string[] | undefined) ?? [];

  return {
    contentRatings: ratings.length ? ratings : DEFAULT_CONTENT_RATINGS,
    languages: languages.length ? languages : DEFAULT_LANGUAGES,
    types: types.length ? types : DEFAULT_CONTENT_TYPES,
    excludedFormats:
      (Application.getState(STATE_KEYS.EXCLUDED_FORMATS) as string[] | undefined) ?? [],
    excludedGenres:
      (Application.getState(STATE_KEYS.EXCLUDED_GENRES) as string[] | undefined) ?? [],
  };
};

// Every settings row persists, invalidates discover and reloads the same way.
const saveSetting = (form: Form, key: string, value: unknown): void => {
  Application.setState(value, key);
  Application.invalidateDiscoverSections();
  form.reloadForm();
};

export const getVisibleSections = (): SectionId[] => {
  const stored = Application.getState(STATE_KEYS.VISIBLE_SECTIONS) as SectionId[] | undefined;
  const visible = stored?.filter((id) => SECTION_IDS.includes(id)) ?? [];
  return visible.length ? visible : SECTION_IDS;
};

export class XComicSettingsForm extends Form {
  private contentRatings: ContentPreferenceRating[];
  private types: SeriesType[];
  private excludedFormats: string[];
  private excludedGenres: string[];
  private languages: string[];
  private visibleSections: SectionId[];

  constructor(
    preferences: XComicPreferences,
    visibleSections: SectionId[],
    private readonly filterOptions: FilterOptions,
  ) {
    super();
    this.contentRatings = preferences.contentRatings;
    this.types = preferences.types;
    this.excludedFormats = preferences.excludedFormats;
    this.excludedGenres = preferences.excludedGenres;
    this.languages = preferences.languages;
    this.visibleSections = visibleSections;
  }

  override getSections() {
    return [
      Section(
        {
          id: "languages",
          footer:
            "Only titles translated into these languages are shown across discover and search.",
        },
        [
          SelectRow("languages", {
            title: "Languages",
            subtitle: this.languages
              .map((code) => LANGUAGE_OPTIONS.find((option) => option.id === code)?.title ?? code)
              .join(", "),
            layout: "list",
            value: this.languages,
            items: LANGUAGE_OPTIONS,
            minItemCount: 1,
            maxItemCount: LANGUAGE_OPTIONS.length,
            onValueChange: Application.Selector(
              this as XComicSettingsForm,
              "handleLanguagesChange",
            ),
          }),
        ],
      ),
      Section("content", [
        SelectRow("content_types", {
          title: "Content types",
          layout: "flow",
          value: this.types,
          items: this.filterOptions.types,
          minItemCount: 1,
          maxItemCount: this.filterOptions.types.length,
          onValueChange: Application.Selector(
            this as XComicSettingsForm,
            "handleContentTypesChange",
          ),
        }),
        SelectRow("content_ratings", {
          title: "Content ratings",
          layout: "flow",
          value: this.contentRatings,
          items: this.filterOptions.contentRatings,
          minItemCount: 1,
          maxItemCount: this.filterOptions.contentRatings.length,
          onValueChange: Application.Selector(
            this as XComicSettingsForm,
            "handleContentRatingsChange",
          ),
        }),
      ]),
      Section("exclusions", [
        SelectRow("excluded_genres", {
          title: "Excluded genres",
          layout: "flow",
          value: this.excludedGenres,
          items: this.filterOptions.genres,
          minItemCount: 0,
          maxItemCount: this.filterOptions.genres.length,
          onValueChange: Application.Selector(
            this as XComicSettingsForm,
            "handleExcludedGenresChange",
          ),
        }),
        SelectRow("excluded_formats", {
          title: "Excluded formats",
          layout: "flow",
          value: this.excludedFormats,
          items: FORMAT_OPTIONS,
          minItemCount: 0,
          maxItemCount: FORMAT_OPTIONS.length,
          onValueChange: Application.Selector(
            this as XComicSettingsForm,
            "handleExcludedFormatsChange",
          ),
        }),
      ]),
      Section("discover", [
        SelectRow("visible_sections", {
          title: "Visible sections",
          layout: "list",
          value: this.visibleSections,
          items: SECTION_OPTIONS,
          minItemCount: 1,
          maxItemCount: SECTION_OPTIONS.length,
          onValueChange: Application.Selector(
            this as XComicSettingsForm,
            "handleVisibleSectionsChange",
          ),
        }),
      ]),
    ];
  }

  async handleLanguagesChange(value: string[]): Promise<void> {
    this.languages = value.length ? value : DEFAULT_LANGUAGES;
    saveSetting(this, STATE_KEYS.LANGUAGES, this.languages);
  }

  async handleContentTypesChange(value: string[]): Promise<void> {
    this.types = value as SeriesType[];
    saveSetting(this, STATE_KEYS.CONTENT_TYPES, this.types);
  }

  async handleContentRatingsChange(value: string[]): Promise<void> {
    this.contentRatings = value as ContentPreferenceRating[];
    saveSetting(this, STATE_KEYS.CONTENT_RATINGS, this.contentRatings);
  }

  async handleExcludedGenresChange(value: string[]): Promise<void> {
    this.excludedGenres = value;
    saveSetting(this, STATE_KEYS.EXCLUDED_GENRES, value);
  }

  async handleExcludedFormatsChange(value: string[]): Promise<void> {
    this.excludedFormats = value;
    saveSetting(this, STATE_KEYS.EXCLUDED_FORMATS, value);
  }

  async handleVisibleSectionsChange(value: string[]): Promise<void> {
    this.visibleSections = value as SectionId[];
    saveSetting(this, STATE_KEYS.VISIBLE_SECTIONS, this.visibleSections);
  }
}
