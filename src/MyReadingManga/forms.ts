/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  EditSection,
  Form,
  LabelRow,
  NavigationRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type FormItemElement,
  type FormSectionElement,
  type SearchQuery,
} from "@paperback/types";

import {
  DISCOVER_SECTIONS,
  LANGUAGES,
  TAXONOMIES,
  type FilterTaxonomies,
  type SearchMetadata,
  type TriState,
} from "./models";

const LANGUAGES_KEY = "myreadingmanga.languages";
const HIDDEN_GENRES_KEY = "myreadingmanga.hiddenGenres";
const HIDDEN_TAGS_KEY = "myreadingmanga.hiddenTags";
const SECTION_ORDER_KEY = "myreadingmanga.sections";
const DELETED_SECTIONS_KEY = "myreadingmanga.deletedSections";

const readStringArray = (key: string): string[] | undefined => {
  const value = Application.getState(key);
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
};

// Preferred language classes used to filter listing cards; defaults to
// English, an explicitly empty selection means every language.
export const getPreferredLanguages = (): string[] => readStringArray(LANGUAGES_KEY) ?? ["english"];

export const getHiddenGenres = (): string[] => readStringArray(HIDDEN_GENRES_KEY) ?? [];

export const getHiddenTags = (): string[] => readStringArray(HIDDEN_TAGS_KEY) ?? [];

const getSectionOrder = (): string[] =>
  readStringArray(SECTION_ORDER_KEY) ?? DISCOVER_SECTIONS.map((section) => section.id);

const getDeletedSections = (): string[] => readStringArray(DELETED_SECTIONS_KEY) ?? [];

// Visible sections in the user's order.
export const getOrderedSections = () =>
  getSectionOrder().flatMap((id) => {
    const section = DISCOVER_SECTIONS.find((entry) => entry.id === id);
    return section ? [section] : [];
  });

export class MyReadingMangaSettingsForm extends Form {
  constructor(private readonly taxonomies: FilterTaxonomies) {
    super();
  }

  override getSections() {
    return [
      Section(
        {
          id: "languages",
          footer:
            "Only show entries in the selected languages in Discover sections. Defaults to English; leave empty to show every language.",
        },
        [
          SelectRow("languages", {
            title: "Languages",
            layout: "flow",
            value: getPreferredLanguages(),
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
      Section(
        {
          id: "hidden",
          footer: "Hidden genres and tags are excluded from Discover sections and search results.",
        },
        [
          SelectRow("hidden_genres", {
            title: "Hide Genres",
            layout: "flow",
            value: getHiddenGenres(),
            items: this.taxonomies.genre ?? [],
            minItemCount: 0,
            maxItemCount: (this.taxonomies.genre ?? []).length,
            onValueChange: Application.Selector(
              this as MyReadingMangaSettingsForm,
              "updateHiddenGenres",
            ),
          }),
          SelectRow("hidden_tags", {
            title: "Hide Tags",
            layout: "flow",
            value: getHiddenTags(),
            items: this.taxonomies.tag ?? [],
            minItemCount: 0,
            maxItemCount: (this.taxonomies.tag ?? []).length,
            onValueChange: Application.Selector(
              this as MyReadingMangaSettingsForm,
              "updateHiddenTags",
            ),
          }),
        ],
      ),
      Section("sections", [
        NavigationRow("section_order", {
          title: "Discover Sections",
          subtitle: "Reorder or remove home sections",
          form: new SectionOrderForm(),
        }),
      ]),
    ];
  }

  async updateLanguages(value: string[]): Promise<void> {
    Application.setState(value, LANGUAGES_KEY);
    Application.invalidateDiscoverSections();
  }

  async updateHiddenGenres(value: string[]): Promise<void> {
    Application.setState(value, HIDDEN_GENRES_KEY);
    Application.invalidateDiscoverSections();
  }

  async updateHiddenTags(value: string[]): Promise<void> {
    Application.setState(value, HIDDEN_TAGS_KEY);
    Application.invalidateDiscoverSections();
  }
}

class SectionOrderForm extends Form {
  constructor() {
    super();
    // One restore handler per section id, addressable by selector name.
    for (const section of DISCOVER_SECTIONS) {
      (this as Record<string, unknown>)[`restore_${section.id}`] = async (): Promise<void> => {
        Application.setState([...getSectionOrder(), section.id], SECTION_ORDER_KEY);
        Application.setState(
          getDeletedSections().filter((id) => id !== section.id),
          DELETED_SECTIONS_KEY,
        );
        Application.invalidateDiscoverSections();
        this.reloadForm();
      };
    }
  }

  override getSections() {
    const deleted = getDeletedSections();
    const sections: FormSectionElement<unknown>[] = [
      EditSection("order", {
        id: "order",
        header: "Home Sections",
        footer: "Long press to reorder, swipe to remove.",
        items: getOrderedSections().map((section): FormItemElement<unknown> =>
          LabelRow(section.id, { title: section.title }),
        ),
        allowDeletion: true,
        allowReorder: true,
        onReorder: Application.Selector(this as SectionOrderForm, "rowDidReorder"),
        onDeletion: Application.Selector(this as SectionOrderForm, "rowDidDelete"),
      }),
    ];

    if (deleted.length > 0) {
      sections.push(
        Section(
          { id: "deleted", footer: "Tap to restore." },
          deleted.flatMap((id) => {
            const section = DISCOVER_SECTIONS.find((entry) => entry.id === id);
            if (!section) return [];
            return [
              LabelRow(id, {
                title: section.title,
                onSelect: Application.Selector(this as SectionOrderForm, `restore_${id}` as never),
              }),
            ];
          }),
        ),
        Section("reset", [
          ButtonRow("reset_sections", {
            title: "Reset Sections",
            onSelect: Application.Selector(this as SectionOrderForm, "resetSections"),
          }),
        ]),
      );
    }
    return sections;
  }

  async rowDidReorder(sourceIndex: number, destinationIndex: number): Promise<void> {
    const order = getSectionOrder();
    const [moved] = order.splice(sourceIndex, 1);
    if (moved) order.splice(destinationIndex, 0, moved);
    Application.setState(order, SECTION_ORDER_KEY);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async rowDidDelete(index: number): Promise<void> {
    const order = getSectionOrder();
    const [removed] = order.splice(index, 1);
    if (removed) {
      Application.setState(order, SECTION_ORDER_KEY);
      Application.setState([...getDeletedSections(), removed], DELETED_SECTIONS_KEY);
    }
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async resetSections(): Promise<void> {
    Application.setState(undefined, SECTION_ORDER_KEY);
    Application.setState(undefined, DELETED_SECTIONS_KEY);
    Application.invalidateDiscoverSections();
    this.reloadForm();
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

  override getSections() {
    const sections = [
      Section("language", [
        SelectRow("language", {
          title: "Language",
          layout: "flow",
          value: this.searchMetadata.language ? [this.searchMetadata.language] : [],
          items: LANGUAGES.map((language) => ({ id: language.code, title: language.name })),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MyReadingMangaAdvancedSearchForm,
            "handleLanguageChange",
          ),
        }),
      ]),
    ];

    // One typed change handler per taxonomy row.
    const handlers = {
      genres: "updateGenres",
      categories: "updateCategories",
      tags: "updateTags",
      artists: "updateArtists",
      pairings: "updatePairings",
      statuses: "updateStatuses",
    } as const satisfies Record<(typeof TAXONOMIES)[number]["key"], string>;

    for (const taxonomy of TAXONOMIES) {
      const options = this.taxonomies[taxonomy.id] ?? [];
      if (options.length === 0) continue;
      sections.push(
        Section({ id: taxonomy.key, footer: "Tap once to include, twice to exclude." }, [
          TriStateSelectRow(taxonomy.key, {
            title: taxonomy.title,
            layout: "flow",
            value: this.searchMetadata[taxonomy.key] ?? {},
            items: options,
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: Application.Selector(
              this as MyReadingMangaAdvancedSearchForm,
              handlers[taxonomy.key],
            ),
          }),
        ]),
      );
    }
    return sections;
  }

  // Empty selections are stored as undefined so the metadata stays sparse;
  // downstream consumers treat a missing record and an empty one identically.
  private static toSparse(value: TriState): TriState | undefined {
    return Object.keys(value).length === 0 ? undefined : value;
  }

  async updateGenres(value: TriState): Promise<void> {
    this.searchMetadata.genres = MyReadingMangaAdvancedSearchForm.toSparse(value);
  }

  async updateCategories(value: TriState): Promise<void> {
    this.searchMetadata.categories = MyReadingMangaAdvancedSearchForm.toSparse(value);
  }

  async updateTags(value: TriState): Promise<void> {
    this.searchMetadata.tags = MyReadingMangaAdvancedSearchForm.toSparse(value);
  }

  async updateArtists(value: TriState): Promise<void> {
    this.searchMetadata.artists = MyReadingMangaAdvancedSearchForm.toSparse(value);
  }

  async updatePairings(value: TriState): Promise<void> {
    this.searchMetadata.pairings = MyReadingMangaAdvancedSearchForm.toSparse(value);
  }

  async updateStatuses(value: TriState): Promise<void> {
    this.searchMetadata.statuses = MyReadingMangaAdvancedSearchForm.toSparse(value);
  }

  async handleLanguageChange(value: string[]): Promise<void> {
    this.searchMetadata.language = value[0] || undefined;
  }
}
