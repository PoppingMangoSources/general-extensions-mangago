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
  type TagSection,
} from "@paperback/types";

import {
  CONTENT_RATING_OPTIONS,
  COUNTRY_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  DEMOGRAPHIC_OPTIONS,
  MATCH_MODE_OPTIONS,
  ORDER_OPTIONS,
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

export const getDeduplicateChapters = (): boolean =>
  (Application.getState(STATE_KEYS.DEDUPLICATE_CHAPTERS) as boolean | undefined) ?? false;

export const getShowUploadSize = (): boolean =>
  (Application.getState(STATE_KEYS.SHOW_UPLOAD_SIZE) as boolean | undefined) ?? true;

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
      Section(
        {
          id: "chapters",
          header: "Chapter Settings",
          footer:
            "Deduplicate Chapters lists only the upload the site shows first for each chapter, not one from every group. Upload Size adds each upload's size to its title and lists a group's uploads of different sizes separately; with it off only the group's best upload is listed.",
        },
        [
          ToggleRow("deduplicate_chapters", {
            title: "Deduplicate Chapters",
            value: getDeduplicateChapters(),
            onValueChange: Application.Selector(
              this as ToonkotsuSettingsForm,
              "handleDeduplicateChaptersChange",
            ),
          }),
          ToggleRow("show_upload_size", {
            title: "Upload Size",
            value: getShowUploadSize(),
            onValueChange: Application.Selector(
              this as ToonkotsuSettingsForm,
              "handleShowUploadSizeChange",
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

  async handleDeduplicateChaptersChange(value: boolean): Promise<void> {
    Application.setState(value, STATE_KEYS.DEDUPLICATE_CHAPTERS);
  }

  async handleShowUploadSizeChange(value: boolean): Promise<void> {
    Application.setState(value, STATE_KEYS.SHOW_UPLOAD_SIZE);
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
  private order: string;
  private hasChapters: boolean;

  constructor(
    query: SearchQuery<SearchMetadata>,
    private readonly tagGroups: TagSection[],
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
    this.order = metadata.order ?? "default";
    this.hasChapters = metadata.hasChapters ?? false;
  }

  private selectRow(
    id: string,
    title: string,
    items: Tag[],
    value: string[],
    single: boolean,
    update: (value: string[]) => void,
  ) {
    return SelectRow(id, {
      title,
      layout: single || items.length > 6 ? "list" : "flow",
      value,
      items,
      minItemCount: single ? 1 : 0,
      maxItemCount: single ? 1 : items.length,
      onValueChange: closureSelector(this, id, async (selected: string[]) => update(selected)),
    });
  }

  private inputRow(id: string, title: string, value: string, update: (value: string) => void) {
    return InputRow(id, {
      title,
      value,
      onValueChange: closureSelector(this, id, async (input: string) => update(input)),
    });
  }

  // Laid out as the site lays out its own filters. Every tag group filters the same genres
  // parameter, so a row only replaces its own tags' states.
  override getSections() {
    return [
      Section("ranges", [
        this.inputRow("year_from", "Year From", this.yearFrom, (value) => (this.yearFrom = value)),
        this.inputRow("year_to", "Year To", this.yearTo, (value) => (this.yearTo = value)),
        this.inputRow(
          "chapters_min",
          "Chapters From",
          this.chaptersMin,
          (value) => (this.chaptersMin = value),
        ),
        this.inputRow(
          "chapters_max",
          "Chapters To",
          this.chaptersMax,
          (value) => (this.chaptersMax = value),
        ),
      ]),
      Section("filters", [
        this.selectRow(
          "statuses",
          "Status",
          STATUS_OPTIONS,
          this.statuses,
          false,
          (value) => (this.statuses = value),
        ),
        this.selectRow(
          "ratings",
          "Content Rating",
          CONTENT_RATING_OPTIONS,
          this.ratings,
          false,
          (value) => (this.ratings = value),
        ),
        this.selectRow(
          "demographics",
          "Demographic",
          DEMOGRAPHIC_OPTIONS,
          this.demographics,
          false,
          (value) => (this.demographics = value),
        ),
        this.selectRow(
          "languages",
          "Country",
          COUNTRY_OPTIONS,
          this.languages,
          false,
          (value) => (this.languages = value),
        ),
        ToggleRow("has_chapters", {
          title: "Has Chapters",
          value: this.hasChapters,
          onValueChange: closureSelector(this, "has_chapters", async (value: boolean) => {
            this.hasChapters = value;
          }),
        }),
      ]),
      Section(
        "tags",
        this.tagGroups.map((group) => {
          const ids = new Set(group.tags.map(({ id }) => id));
          return TriStateSelectRow(group.id, {
            title: group.title,
            layout: "flow",
            value: Object.fromEntries(Object.entries(this.genres).filter(([id]) => ids.has(id))),
            items: group.tags,
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: closureSelector(this, group.id, async (value: TriState) => {
              this.genres = {
                ...Object.fromEntries(Object.entries(this.genres).filter(([id]) => !ids.has(id))),
                ...value,
              };
            }),
          });
        }),
      ),
      Section("tag_modes", [
        this.selectRow(
          "genre_mode",
          "Tag Inclusion Mode",
          MATCH_MODE_OPTIONS,
          [this.genreMode],
          true,
          (value) => (this.genreMode = value[0] ?? "all"),
        ),
        this.selectRow(
          "exclude_mode",
          "Tag Exclusion Mode",
          MATCH_MODE_OPTIONS,
          [this.excludeMode],
          true,
          (value) => (this.excludeMode = value[0] ?? "any"),
        ),
      ]),
      // Paperback's sort menu has no direction of its own; the site sets it here, beside the sort.
      Section("order", [
        this.selectRow(
          "order",
          "Order",
          ORDER_OPTIONS,
          [this.order],
          true,
          (value) => (this.order = value[0] ?? "default"),
        ),
      ]),
      Section("author", [
        this.inputRow("author", "Author", this.author, (value) => (this.author = value)),
      ]),
    ];
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {
      genreMode: this.genreMode,
      excludeMode: this.excludeMode,
    };
    if (Object.keys(this.genres).length) result.genres = this.genres;
    if (this.demographics.length) result.demographics = this.demographics;
    if (this.statuses.length) result.statuses = this.statuses;
    if (this.languages.length) result.languages = this.languages;
    if (this.ratings.length) result.ratings = this.ratings;
    if (this.author.trim()) result.author = this.author.trim();
    if (this.yearFrom.trim()) result.yearFrom = this.yearFrom.trim();
    if (this.yearTo.trim()) result.yearTo = this.yearTo.trim();
    if (this.chaptersMin.trim()) result.chaptersMin = this.chaptersMin.trim();
    if (this.chaptersMax.trim()) result.chaptersMax = this.chaptersMax.trim();
    if (this.order !== "default") result.order = this.order;
    if (this.hasChapters) result.hasChapters = this.hasChapters;
    return result;
  }
}
