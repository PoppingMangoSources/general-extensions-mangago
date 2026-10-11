/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  closureSelector,
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
  CHAPTER_LANGUAGE_OPTIONS,
  CONTENT_RATING_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  DEMOGRAPHIC_OPTIONS,
  MATCH_MODE_OPTIONS,
  ORIGINAL_LANGUAGE_OPTIONS,
  SECTION_DEFINITIONS,
  SECTION_IDS,
  STATE_KEYS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
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

export const getChapterLanguages = (): string[] =>
  storedSelection(
    STATE_KEYS.CHAPTER_LANGUAGES,
    CHAPTER_LANGUAGE_OPTIONS.map(({ id }) => id),
    ["en"],
  );

export const getContentRatings = (): string[] =>
  storedSelection(
    STATE_KEYS.CONTENT_RATINGS,
    CONTENT_RATING_OPTIONS.map(({ id }) => id),
    DEFAULT_CONTENT_RATINGS,
  );

export const getTypes = (): string[] => {
  const ids = TYPE_OPTIONS.map(({ id }) => id);
  return storedSelection(STATE_KEYS.TYPES, ids, ids);
};

export const getHiddenTags = (): string[] =>
  (Application.getState(STATE_KEYS.HIDDEN_TAGS) as string[] | undefined) ?? [];

export const getSectionOrder = (): SectionId[] => {
  const stored = (Application.getState(STATE_KEYS.SECTION_ORDER) as SectionId[] | undefined) ?? [];
  const order = [...new Set(stored.filter((id) => SECTION_IDS.includes(id)))];
  return [...order, ...SECTION_IDS.filter((id) => !order.includes(id))];
};

export const getHiddenSections = (): SectionId[] =>
  (Application.getState(STATE_KEYS.HIDDEN_SECTIONS) as SectionId[] | undefined) ?? [];

class ToonkotsuHomeSectionsForm extends Form {
  private order = getSectionOrder();
  private hidden = new Set(getHiddenSections());

  override getSections() {
    return [
      Section(
        { id: "visible_sections", header: "Show Sections" },
        this.order.map((id) =>
          ToggleRow(`show_${id}`, {
            title: SECTION_DEFINITIONS[id].title,
            value: !this.hidden.has(id),
            onValueChange: closureSelector(this, `show_${id}`, async (value: boolean) => {
              if (value) this.hidden.delete(id);
              else this.hidden.add(id);
              Application.setState([...this.hidden], STATE_KEYS.HIDDEN_SECTIONS);
              Application.invalidateDiscoverSections();
            }),
          }),
        ),
      ),
      EditSection("section_order", {
        id: "section_order",
        header: "Section Order",
        footer: "Drag to reorder the Discover sections.",
        items: this.order.map((id) => LabelRow(id, { title: SECTION_DEFINITIONS[id].title })),
        allowReorder: true,
        onReorder: closureSelector(
          this,
          "reorder_sections",
          async (sourceIndex: number, destinationIndex: number) => {
            const order = [...this.order];
            const [moved] = order.splice(sourceIndex, 1);
            if (!moved) return;
            order.splice(destinationIndex, 0, moved);
            this.order = order;
            Application.setState(order, STATE_KEYS.SECTION_ORDER);
            Application.invalidateDiscoverSections();
            this.reloadForm();
          },
        ),
      }),
    ];
  }
}

export class ToonkotsuSettingsForm extends Form {
  constructor(private readonly tagOptions: Tag[]) {
    super();
  }

  override getSections() {
    return [
      Section(
        {
          id: "browse",
          header: "Browse Settings",
          footer:
            "Applies to Discover and search. Pornographic titles are only requested when that rating is on.",
        },
        [
          SelectRow("chapter_languages", {
            title: "Chapter Languages",
            layout: "list",
            value: getChapterLanguages(),
            items: CHAPTER_LANGUAGE_OPTIONS,
            minItemCount: 1,
            maxItemCount: CHAPTER_LANGUAGE_OPTIONS.length,
            onValueChange: Application.Selector(
              this as ToonkotsuSettingsForm,
              "handleChapterLanguagesChange",
            ),
          }),
          SelectRow("content_ratings", {
            title: "Content Ratings",
            layout: "flow",
            value: getContentRatings(),
            items: CONTENT_RATING_OPTIONS,
            minItemCount: 1,
            maxItemCount: CONTENT_RATING_OPTIONS.length,
            onValueChange: Application.Selector(
              this as ToonkotsuSettingsForm,
              "handleContentRatingsChange",
            ),
          }),
          SelectRow("types", {
            title: "Types",
            layout: "flow",
            value: getTypes(),
            items: TYPE_OPTIONS,
            minItemCount: 1,
            maxItemCount: TYPE_OPTIONS.length,
            onValueChange: Application.Selector(this as ToonkotsuSettingsForm, "handleTypesChange"),
          }),
          SelectRow("hidden_tags", {
            title: "Hidden Tags",
            subtitle: "Titles with these tags are left out",
            layout: "list",
            value: getHiddenTags(),
            items: this.tagOptions,
            minItemCount: 0,
            maxItemCount: this.tagOptions.length,
            onValueChange: Application.Selector(
              this as ToonkotsuSettingsForm,
              "handleHiddenTagsChange",
            ),
          }),
        ],
      ),
      Section("home", [
        NavigationRow("home_sections", {
          title: "Home Sections",
          subtitle: "Choose and reorder the Discover sections",
          form: new ToonkotsuHomeSectionsForm(),
        }),
      ]),
    ];
  }

  private save(key: string, value: string[]): void {
    Application.setState(value, key);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleChapterLanguagesChange(value: string[]): Promise<void> {
    this.save(STATE_KEYS.CHAPTER_LANGUAGES, value);
  }

  async handleContentRatingsChange(value: string[]): Promise<void> {
    this.save(STATE_KEYS.CONTENT_RATINGS, value);
  }

  async handleTypesChange(value: string[]): Promise<void> {
    this.save(STATE_KEYS.TYPES, value);
  }

  async handleHiddenTagsChange(value: string[]): Promise<void> {
    this.save(STATE_KEYS.HIDDEN_TAGS, value);
  }
}

export class ToonkotsuSearchForm extends AdvancedSearchForm {
  private genres: TriState;
  private genreMode: string;
  private excludeMode: string;
  private demographics: string[];
  private statuses: string[];
  private languages: string[];
  private ratings: string[];
  private author: string;
  private yearFrom: string;
  private yearTo: string;
  private chaptersMin: string;
  private chaptersMax: string;

  constructor(
    query: SearchQuery<SearchMetadata>,
    private readonly genreOptions: Tag[],
  ) {
    super();
    const metadata = query.metadata ?? {};
    this.genres = metadata.genres ?? {};
    this.genreMode = metadata.genreMode ?? "all";
    this.excludeMode = metadata.excludeMode ?? "any";
    this.demographics = metadata.demographics ?? [];
    this.statuses = metadata.statuses ?? [];
    this.languages = metadata.languages ?? [];
    this.ratings = metadata.ratings ?? getContentRatings();
    this.author = metadata.author ?? "";
    this.yearFrom = metadata.yearFrom ?? "";
    this.yearTo = metadata.yearTo ?? "";
    this.chaptersMin = metadata.chaptersMin ?? "";
    this.chaptersMax = metadata.chaptersMax ?? "";
  }

  override getSections() {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleGenresChange"),
        }),
        SelectRow("genre_mode", {
          title: "Included Genres Must Match",
          layout: "list",
          value: [this.genreMode],
          items: MATCH_MODE_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleGenreModeChange"),
        }),
        SelectRow("exclude_mode", {
          title: "Excluded Genres Must Match",
          layout: "list",
          value: [this.excludeMode],
          items: MATCH_MODE_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as ToonkotsuSearchForm,
            "handleExcludeModeChange",
          ),
        }),
      ]),
      Section("filters", [
        SelectRow("demographics", {
          title: "Demographic",
          layout: "flow",
          value: this.demographics,
          items: DEMOGRAPHIC_OPTIONS,
          minItemCount: 0,
          maxItemCount: DEMOGRAPHIC_OPTIONS.length,
          onValueChange: Application.Selector(
            this as ToonkotsuSearchForm,
            "handleDemographicsChange",
          ),
        }),
        SelectRow("statuses", {
          title: "Publication Status",
          layout: "flow",
          value: this.statuses,
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: STATUS_OPTIONS.length,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleStatusesChange"),
        }),
        SelectRow("languages", {
          title: "Original Language",
          layout: "list",
          value: this.languages,
          items: ORIGINAL_LANGUAGE_OPTIONS,
          minItemCount: 0,
          maxItemCount: ORIGINAL_LANGUAGE_OPTIONS.length,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleLanguagesChange"),
        }),
        SelectRow("ratings", {
          title: "Content Rating",
          layout: "flow",
          value: this.ratings,
          items: CONTENT_RATING_OPTIONS,
          minItemCount: 1,
          maxItemCount: CONTENT_RATING_OPTIONS.length,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleRatingsChange"),
        }),
      ]),
      Section("details", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleAuthorChange"),
        }),
        InputRow("year_from", {
          title: "Year From",
          value: this.yearFrom,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleYearFromChange"),
        }),
        InputRow("year_to", {
          title: "Year To",
          value: this.yearTo,
          onValueChange: Application.Selector(this as ToonkotsuSearchForm, "handleYearToChange"),
        }),
        InputRow("chapters_min", {
          title: "Minimum Chapters",
          value: this.chaptersMin,
          onValueChange: Application.Selector(
            this as ToonkotsuSearchForm,
            "handleChaptersMinChange",
          ),
        }),
        InputRow("chapters_max", {
          title: "Maximum Chapters",
          value: this.chaptersMax,
          onValueChange: Application.Selector(
            this as ToonkotsuSearchForm,
            "handleChaptersMaxChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }
  async handleGenreModeChange(value: string[]): Promise<void> {
    this.genreMode = value[0] ?? "all";
  }
  async handleExcludeModeChange(value: string[]): Promise<void> {
    this.excludeMode = value[0] ?? "any";
  }
  async handleDemographicsChange(value: string[]): Promise<void> {
    this.demographics = value;
  }
  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }
  async handleLanguagesChange(value: string[]): Promise<void> {
    this.languages = value;
  }
  async handleRatingsChange(value: string[]): Promise<void> {
    this.ratings = value;
  }
  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }
  async handleYearFromChange(value: string): Promise<void> {
    this.yearFrom = value;
  }
  async handleYearToChange(value: string): Promise<void> {
    this.yearTo = value;
  }
  async handleChaptersMinChange(value: string): Promise<void> {
    this.chaptersMin = value;
  }
  async handleChaptersMaxChange(value: string): Promise<void> {
    this.chaptersMax = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      genres: Object.keys(this.genres).length ? this.genres : undefined,
      genreMode: this.genreMode,
      excludeMode: this.excludeMode,
      demographics: this.demographics.length ? this.demographics : undefined,
      statuses: this.statuses.length ? this.statuses : undefined,
      languages: this.languages.length ? this.languages : undefined,
      ratings: this.ratings.length ? this.ratings : undefined,
      author: this.author.trim() || undefined,
      yearFrom: this.yearFrom.trim() || undefined,
      yearTo: this.yearTo.trim() || undefined,
      chaptersMin: this.chaptersMin.trim() || undefined,
      chaptersMax: this.chaptersMax.trim() || undefined,
    };
  }
}
