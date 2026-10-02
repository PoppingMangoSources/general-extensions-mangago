/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  EditSection,
  Form,
  InputRow,
  LabelRow,
  NavigationRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  CONTENT_RATING_OPTIONS,
  DEFAULT_LANGUAGES,
  DEFAULT_RATINGS,
  DEFAULT_TYPES,
  DEMOGRAPHIC_OPTIONS,
  LANGUAGE_OPTIONS,
  SECTION_IDS,
  SECTION_OPTIONS,
  STATE_KEYS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type Preferences,
  type SearchMetadata,
  type SectionId,
  type TriState,
} from "./models";

const storedSelection = (key: string, valid: string[], fallback: string[]): string[] => {
  const value = Application.getState(key);
  if (!Array.isArray(value)) return fallback;
  const selected = value.filter(
    (entry): entry is string => typeof entry === "string" && valid.includes(entry),
  );
  return selected.length ? [...new Set(selected)] : fallback;
};

export const getPreferences = (): Preferences => ({
  chapterLanguages: storedSelection(
    STATE_KEYS.CHAPTER_LANGUAGES,
    LANGUAGE_OPTIONS.map(({ id }) => id),
    DEFAULT_LANGUAGES,
  ),
  contentRatings: storedSelection(STATE_KEYS.CONTENT_RATINGS, DEFAULT_RATINGS, DEFAULT_RATINGS),
  contentTypes: storedSelection(STATE_KEYS.CONTENT_TYPES, DEFAULT_TYPES, DEFAULT_TYPES),
  hiddenTags:
    (Application.getState(STATE_KEYS.HIDDEN_TAGS) as string[] | undefined)?.filter(Boolean) ?? [],
  officialOnly: (Application.getState(STATE_KEYS.OFFICIAL_ONLY) as boolean | undefined) ?? false,
});

export const getSectionOrder = (): SectionId[] => {
  const stored = (Application.getState(STATE_KEYS.SECTION_ORDER) as SectionId[] | undefined) ?? [];
  const order = [...new Set(stored.filter((id) => SECTION_IDS.includes(id)))];
  return [...order, ...SECTION_IDS.filter((id) => !order.includes(id))];
};

export const getVisibleSections = (): SectionId[] => {
  const stored = Application.getState(STATE_KEYS.VISIBLE_SECTIONS) as SectionId[] | undefined;
  const visible = stored?.filter((id) => SECTION_IDS.includes(id)) ?? [];
  return visible.length ? [...new Set(visible)] : SECTION_IDS;
};

const parseList = (value: string): string[] => [
  ...new Set(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ),
];

export class YaoiMeSectionOrderForm extends Form {
  constructor(private order: SectionId[]) {
    super();
  }

  override getSections() {
    return [
      EditSection("section_order", {
        id: "section_order",
        header: "Section Order",
        items: this.order.map((id) =>
          LabelRow(id, {
            title: SECTION_OPTIONS.find((option) => option.id === id)?.title ?? id,
          }),
        ),
        allowReorder: true,
        onReorder: Application.Selector(this as YaoiMeSectionOrderForm, "handleReorder"),
      }),
    ];
  }

  async handleReorder(sourceIndex: number, destinationIndex: number): Promise<void> {
    if (
      sourceIndex < 0 ||
      destinationIndex < 0 ||
      sourceIndex >= this.order.length ||
      destinationIndex >= this.order.length
    ) {
      return;
    }
    const order = [...this.order];
    const [moved] = order.splice(sourceIndex, 1);
    if (!moved) return;
    order.splice(destinationIndex, 0, moved);
    this.order = order;
    Application.setState(order, STATE_KEYS.SECTION_ORDER);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}

export class YaoiMeSettingsForm extends Form {
  private chapterLanguages: string[];
  private contentRatings: string[];
  private contentTypes: string[];
  private hiddenTags: string;
  private officialOnly: boolean;
  private visibleSections: SectionId[];

  constructor(
    preferences: Preferences,
    visibleSections: SectionId[],
    private readonly onPreferencesChange: () => void,
  ) {
    super();
    this.chapterLanguages = preferences.chapterLanguages;
    this.contentRatings = preferences.contentRatings;
    this.contentTypes = preferences.contentTypes;
    this.hiddenTags = preferences.hiddenTags.join(", ");
    this.officialOnly = preferences.officialOnly;
    this.visibleSections = visibleSections;
  }

  override getSections() {
    return [
      Section("filters", [
        SelectRow("chapter_languages", {
          title: "Chapter Languages",
          layout: "list",
          value: this.chapterLanguages,
          items: LANGUAGE_OPTIONS,
          minItemCount: 1,
          maxItemCount: LANGUAGE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeSettingsForm,
            "handleChapterLanguagesChange",
          ),
        }),
        SelectRow("content_types", {
          title: "Types",
          layout: "flow",
          value: this.contentTypes,
          items: TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: TYPE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeSettingsForm,
            "handleContentTypesChange",
          ),
        }),
        SelectRow("content_ratings", {
          title: "Content Ratings",
          layout: "flow",
          value: this.contentRatings,
          items: CONTENT_RATING_OPTIONS,
          minItemCount: 1,
          maxItemCount: CONTENT_RATING_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeSettingsForm,
            "handleContentRatingsChange",
          ),
        }),
        InputRow("hidden_tags", {
          title: "Hidden Tags (comma-separated)",
          value: this.hiddenTags,
          onValueChange: Application.Selector(this as YaoiMeSettingsForm, "handleHiddenTagsChange"),
        }),
        ToggleRow("official_only", {
          title: "Official Chapters Only",
          value: this.officialOnly,
          onValueChange: Application.Selector(
            this as YaoiMeSettingsForm,
            "handleOfficialOnlyChange",
          ),
        }),
      ]),
      Section("discover", [
        SelectRow("visible_sections", {
          title: "Visible Sections",
          layout: "list",
          value: this.visibleSections,
          items: SECTION_OPTIONS,
          minItemCount: 1,
          maxItemCount: SECTION_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeSettingsForm,
            "handleVisibleSectionsChange",
          ),
        }),
        NavigationRow("section_order", {
          title: "Section Order",
          form: new YaoiMeSectionOrderForm(getSectionOrder()),
        }),
      ]),
    ];
  }

  private save(key: string, value: unknown): void {
    Application.setState(value, key);
    this.onPreferencesChange();
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleChapterLanguagesChange(value: string[]): Promise<void> {
    this.chapterLanguages = value;
    this.save(STATE_KEYS.CHAPTER_LANGUAGES, value);
  }

  async handleContentTypesChange(value: string[]): Promise<void> {
    this.contentTypes = value;
    this.save(STATE_KEYS.CONTENT_TYPES, value);
  }

  async handleContentRatingsChange(value: string[]): Promise<void> {
    this.contentRatings = value;
    this.save(STATE_KEYS.CONTENT_RATINGS, value);
  }

  async handleHiddenTagsChange(value: string): Promise<void> {
    this.hiddenTags = value;
    this.save(STATE_KEYS.HIDDEN_TAGS, parseList(value));
  }

  async handleOfficialOnlyChange(value: boolean): Promise<void> {
    this.officialOnly = value;
    this.save(STATE_KEYS.OFFICIAL_ONLY, value);
  }

  async handleVisibleSectionsChange(value: string[]): Promise<void> {
    this.visibleSections = value as SectionId[];
    this.save(STATE_KEYS.VISIBLE_SECTIONS, this.visibleSections);
  }
}

export class YaoiMeAdvancedSearchForm extends AdvancedSearchForm {
  private anime: boolean;
  private artist: string;
  private author: string;
  private demographics: string[];
  private genres: TriState;
  private languages: string[];
  private licensed: boolean;
  private maxChapters: string;
  private maxRating: string;
  private minChapters: string;
  private minPages: string;
  private minRating: string;
  private publisher: string;
  private ratings: string[];
  private statuses: string[];
  private tags: TriState;
  private types: string[];
  private updatedWithin: string;
  private yearFrom: string;
  private yearTo: string;

  constructor(
    query: SearchQuery<SearchMetadata>,
    preferences: Preferences,
    private readonly genreOptions: Tag[],
  ) {
    super();
    const metadata = query.metadata ?? {};
    this.anime = metadata.anime ?? false;
    this.artist = metadata.artist ?? "";
    this.author = metadata.author ?? "";
    this.demographics = metadata.demographics ?? [];
    this.genres = metadata.genres ?? {};
    this.languages = metadata.languages ?? preferences.chapterLanguages;
    this.licensed = metadata.licensed ?? false;
    this.maxChapters = metadata.maxChapters ?? "";
    this.maxRating = metadata.maxRating ?? "";
    this.minChapters = metadata.minChapters ?? "";
    this.minPages = metadata.minPages ?? "";
    this.minRating = metadata.minRating ?? "";
    this.publisher = metadata.publisher ?? "";
    this.ratings = metadata.ratings ?? preferences.contentRatings;
    this.statuses = metadata.statuses ?? [];
    this.tags = metadata.tags ?? {};
    this.types = metadata.types ?? preferences.contentTypes;
    this.updatedWithin = metadata.updatedWithin ?? "";
    this.yearFrom = metadata.yearFrom ?? "";
    this.yearTo = metadata.yearTo ?? "";
  }

  override getSections() {
    const includedTags = Object.entries(this.tags)
      .filter(([, state]) => state === "included")
      .map(([tag]) => tag)
      .join(", ");
    const excludedTags = Object.entries(this.tags)
      .filter(([, state]) => state === "excluded")
      .map(([tag]) => tag)
      .join(", ");
    return [
      Section("content", [
        SelectRow("types", {
          title: "Types",
          layout: "flow",
          value: this.types,
          items: TYPE_OPTIONS,
          minItemCount: 0,
          maxItemCount: TYPE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleTypesChange",
          ),
        }),
        SelectRow("ratings", {
          title: "Content Ratings",
          layout: "flow",
          value: this.ratings,
          items: CONTENT_RATING_OPTIONS,
          minItemCount: 0,
          maxItemCount: CONTENT_RATING_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleRatingsChange",
          ),
        }),
        SelectRow("statuses", {
          title: "Publication Status",
          layout: "flow",
          value: this.statuses,
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: STATUS_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
        SelectRow("demographics", {
          title: "Demographics",
          layout: "flow",
          value: this.demographics,
          items: DEMOGRAPHIC_OPTIONS,
          minItemCount: 0,
          maxItemCount: DEMOGRAPHIC_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleDemographicsChange",
          ),
        }),
        SelectRow("languages", {
          title: "Chapter Languages",
          layout: "list",
          value: this.languages,
          items: LANGUAGE_OPTIONS,
          minItemCount: 0,
          maxItemCount: LANGUAGE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleLanguagesChange",
          ),
        }),
      ]),
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
        InputRow("included_tags", {
          title: "Included Tags (comma-separated)",
          value: includedTags,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleIncludedTagsChange",
          ),
        }),
        InputRow("excluded_tags", {
          title: "Excluded Tags (comma-separated)",
          value: excludedTags,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleExcludedTagsChange",
          ),
        }),
      ]),
      Section("credits", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleArtistChange",
          ),
        }),
        InputRow("publisher", {
          title: "Publisher",
          value: this.publisher,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handlePublisherChange",
          ),
        }),
      ]),
      Section("range", [
        InputRow("year_from", {
          title: "Release Year From",
          value: this.yearFrom,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleYearFromChange",
          ),
        }),
        InputRow("year_to", {
          title: "Release Year To",
          value: this.yearTo,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleYearToChange",
          ),
        }),
        InputRow("min_chapters", {
          title: "Minimum Chapters",
          value: this.minChapters,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleMinChaptersChange",
          ),
        }),
        InputRow("max_chapters", {
          title: "Maximum Chapters",
          value: this.maxChapters,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleMaxChaptersChange",
          ),
        }),
        InputRow("min_pages", {
          title: "Minimum Pages",
          value: this.minPages,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleMinPagesChange",
          ),
        }),
        InputRow("min_rating", {
          title: "Minimum Rating",
          value: this.minRating,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleMinRatingChange",
          ),
        }),
        InputRow("max_rating", {
          title: "Maximum Rating",
          value: this.maxRating,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleMaxRatingChange",
          ),
        }),
        InputRow("updated_within", {
          title: "Updated Within (days)",
          value: this.updatedWithin,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleUpdatedWithinChange",
          ),
        }),
        ToggleRow("licensed", {
          title: "Licensed Only",
          value: this.licensed,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleLicensedChange",
          ),
        }),
        ToggleRow("anime", {
          title: "Anime Adaptation Only",
          value: this.anime,
          onValueChange: Application.Selector(
            this as YaoiMeAdvancedSearchForm,
            "handleAnimeChange",
          ),
        }),
      ]),
    ];
  }

  async handleAnimeChange(value: boolean): Promise<void> {
    this.anime = value;
  }
  async handleArtistChange(value: string): Promise<void> {
    this.artist = value;
  }
  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }
  async handleDemographicsChange(value: string[]): Promise<void> {
    this.demographics = value;
  }
  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }
  async handleLanguagesChange(value: string[]): Promise<void> {
    this.languages = value;
  }
  async handleLicensedChange(value: boolean): Promise<void> {
    this.licensed = value;
  }
  async handleMaxChaptersChange(value: string): Promise<void> {
    this.maxChapters = value;
  }
  async handleMaxRatingChange(value: string): Promise<void> {
    this.maxRating = value;
  }
  async handleMinChaptersChange(value: string): Promise<void> {
    this.minChapters = value;
  }
  async handleMinPagesChange(value: string): Promise<void> {
    this.minPages = value;
  }
  async handleMinRatingChange(value: string): Promise<void> {
    this.minRating = value;
  }
  async handlePublisherChange(value: string): Promise<void> {
    this.publisher = value;
  }
  async handleRatingsChange(value: string[]): Promise<void> {
    this.ratings = value;
  }
  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }
  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value;
  }
  async handleUpdatedWithinChange(value: string): Promise<void> {
    this.updatedWithin = value;
  }
  async handleYearFromChange(value: string): Promise<void> {
    this.yearFrom = value;
  }
  async handleYearToChange(value: string): Promise<void> {
    this.yearTo = value;
  }

  async handleIncludedTagsChange(value: string): Promise<void> {
    const excluded = Object.entries(this.tags).filter(([, state]) => state === "excluded");
    this.tags = Object.fromEntries([
      ...excluded,
      ...parseList(value).map((tag) => [tag, "included"] as const),
    ]);
  }

  async handleExcludedTagsChange(value: string): Promise<void> {
    const included = Object.entries(this.tags).filter(([, state]) => state === "included");
    this.tags = Object.fromEntries([
      ...included,
      ...parseList(value).map((tag) => [tag, "excluded"] as const),
    ]);
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      anime: this.anime || undefined,
      artist: this.artist || undefined,
      author: this.author || undefined,
      demographics: this.demographics.length ? this.demographics : undefined,
      genres: Object.keys(this.genres).length ? this.genres : undefined,
      languages: this.languages.length ? this.languages : undefined,
      licensed: this.licensed || undefined,
      maxChapters: this.maxChapters || undefined,
      maxRating: this.maxRating || undefined,
      minChapters: this.minChapters || undefined,
      minPages: this.minPages || undefined,
      minRating: this.minRating || undefined,
      publisher: this.publisher || undefined,
      ratings: this.ratings.length ? this.ratings : undefined,
      statuses: this.statuses.length ? this.statuses : undefined,
      tags: Object.keys(this.tags).length ? this.tags : undefined,
      types: this.types.length ? this.types : undefined,
      updatedWithin: this.updatedWithin || undefined,
      yearFrom: this.yearFrom || undefined,
      yearTo: this.yearTo || undefined,
    };
  }
}
