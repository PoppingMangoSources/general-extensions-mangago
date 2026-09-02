/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, SelectRow } from "@paperback/types";

import {
  CONTENT_RATING_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  DEFAULT_CONTENT_TYPES,
  DEFAULT_LANGUAGES,
  LANGUAGE_OPTIONS,
  LEGACY_FORMAT_MAP,
  LEGACY_TYPE_MAP,
  SECTION_IDS,
  SECTION_OPTIONS,
  SECTIONS,
  STATE_KEYS,
  VISIBLE_SECTIONS_VERSION,
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

  const validTypes = new Set(DEFAULT_CONTENT_TYPES);
  const storedTypes =
    (Application.getState(STATE_KEYS.CONTENT_TYPES) as string[] | undefined) ?? [];
  const types = [...new Set(storedTypes.map((type) => LEGACY_TYPE_MAP[type] ?? type))].filter(
    (type): type is SeriesType => validTypes.has(type as SeriesType),
  );
  const hadLegacyDefaults = [
    "artbook",
    "cartoon",
    "imageset",
    "manga",
    "manhua",
    "manhwa",
    "western",
  ].every((type) => storedTypes.includes(type));

  const validLanguages = new Set(LANGUAGE_OPTIONS.map(({ id }) => id));
  const originalLanguages = (
    (Application.getState(STATE_KEYS.ORIGINAL_LANGUAGES) as string[] | undefined) ?? []
  ).filter((language) => validLanguages.has(language));
  const translatedLanguages = (
    (Application.getState(STATE_KEYS.TRANSLATED_LANGUAGES) as string[] | undefined) ?? []
  ).filter((language) => validLanguages.has(language));

  return {
    contentRatings: ratings.length ? ratings : DEFAULT_CONTENT_RATINGS,
    originalLanguages,
    translatedLanguages: translatedLanguages.length ? translatedLanguages : DEFAULT_LANGUAGES,
    types: hadLegacyDefaults || !types.length ? DEFAULT_CONTENT_TYPES : types,
    excludedFormats:
      (Application.getState(STATE_KEYS.EXCLUDED_FORMATS) as string[] | undefined)?.map(
        (id) => LEGACY_FORMAT_MAP[id] ?? id,
      ) ?? [],
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
  const version = Application.getState(STATE_KEYS.VISIBLE_SECTIONS_VERSION) as number | undefined;
  if (visible.length && version !== VISIBLE_SECTIONS_VERSION) {
    const migrated = [
      ...new Set([
        ...visible,
        SECTIONS.MOST_FOLLOWS,
        SECTIONS.MOST_CHAPTERS,
        SECTIONS.MOST_REVIEWS,
        SECTIONS.MOST_COMMENTS,
      ]),
    ] as SectionId[];
    Application.setState(migrated, STATE_KEYS.VISIBLE_SECTIONS);
    Application.setState(VISIBLE_SECTIONS_VERSION, STATE_KEYS.VISIBLE_SECTIONS_VERSION);
    return migrated;
  }
  return visible.length ? visible : SECTION_IDS;
};

export class XComicSettingsForm extends Form {
  private contentRatings: ContentPreferenceRating[];
  private types: SeriesType[];
  private excludedFormats: string[];
  private excludedGenres: string[];
  private originalLanguages: string[];
  private translatedLanguages: string[];
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
    this.originalLanguages = preferences.originalLanguages;
    this.translatedLanguages = preferences.translatedLanguages;
    this.visibleSections = visibleSections;
  }

  override getSections() {
    return [
      Section(
        {
          id: "languages",
          footer: "These defaults apply across Discover and Search.",
        },
        [
          SelectRow("original_languages", {
            title: "Original languages",
            subtitle: this.originalLanguages.length
              ? this.originalLanguages
                  .map(
                    (code) => LANGUAGE_OPTIONS.find((option) => option.id === code)?.title ?? code,
                  )
                  .join(", ")
              : "All",
            layout: "list",
            value: this.originalLanguages,
            items: LANGUAGE_OPTIONS,
            minItemCount: 0,
            maxItemCount: LANGUAGE_OPTIONS.length,
            onValueChange: Application.Selector(
              this as XComicSettingsForm,
              "handleOriginalLanguagesChange",
            ),
          }),
          SelectRow("translated_languages", {
            title: "Translated languages",
            subtitle: this.translatedLanguages
              .map((code) => LANGUAGE_OPTIONS.find((option) => option.id === code)?.title ?? code)
              .join(", "),
            layout: "list",
            value: this.translatedLanguages,
            items: LANGUAGE_OPTIONS,
            minItemCount: 1,
            maxItemCount: LANGUAGE_OPTIONS.length,
            onValueChange: Application.Selector(
              this as XComicSettingsForm,
              "handleTranslatedLanguagesChange",
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
          items: this.filterOptions.formats,
          minItemCount: 0,
          maxItemCount: this.filterOptions.formats.length,
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

  async handleOriginalLanguagesChange(value: string[]): Promise<void> {
    this.originalLanguages = value;
    saveSetting(this, STATE_KEYS.ORIGINAL_LANGUAGES, value);
  }

  async handleTranslatedLanguagesChange(value: string[]): Promise<void> {
    this.translatedLanguages = value.length ? value : DEFAULT_LANGUAGES;
    saveSetting(this, STATE_KEYS.TRANSLATED_LANGUAGES, this.translatedLanguages);
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
    Application.setState(VISIBLE_SECTIONS_VERSION, STATE_KEYS.VISIBLE_SECTIONS_VERSION);
    saveSetting(this, STATE_KEYS.VISIBLE_SECTIONS, this.visibleSections);
  }
}
