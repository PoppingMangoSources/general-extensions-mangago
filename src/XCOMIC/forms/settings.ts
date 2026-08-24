/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { EditSection, Form, LabelRow, NavigationRow, Section, SelectRow } from "@paperback/types";

import {
  CONTENT_RATING_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  DEFAULT_CONTENT_TYPES,
  SECTION_IDS,
  SECTION_OPTIONS,
  STATE_KEYS,
  TYPE_OPTIONS,
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

  const validTypes = new Set(TYPE_OPTIONS.map((option) => option.id));
  const storedTypes =
    (Application.getState(STATE_KEYS.CONTENT_TYPES) as SeriesType[] | undefined) ?? [];
  const types = storedTypes.filter((type) => validTypes.has(type));

  return {
    contentRatings: ratings.length ? ratings : DEFAULT_CONTENT_RATINGS,
    types: types.length ? types : DEFAULT_CONTENT_TYPES,
    excludedGenres:
      (Application.getState(STATE_KEYS.EXCLUDED_GENRES) as string[] | undefined) ?? [],
    excludedTags: (Application.getState(STATE_KEYS.EXCLUDED_TAGS) as string[] | undefined) ?? [],
  };
};

export const getSectionOrder = (): SectionId[] => {
  const stored = (Application.getState(STATE_KEYS.SECTION_ORDER) as SectionId[] | undefined) ?? [];
  const order = [...new Set(stored.filter((id) => SECTION_IDS.includes(id)))];
  return [...order, ...SECTION_IDS.filter((id) => !order.includes(id))];
};

export const getVisibleSections = (): SectionId[] => {
  const stored = Application.getState(STATE_KEYS.VISIBLE_SECTIONS) as SectionId[] | undefined;
  const visible = stored?.filter((id) => SECTION_IDS.includes(id)) ?? [];
  return visible.length ? visible : SECTION_IDS;
};

export class XComicSectionOrderForm extends Form {
  private order: SectionId[];

  constructor(order: SectionId[]) {
    super();
    this.order = order;
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
        onReorder: Application.Selector(this as XComicSectionOrderForm, "handleReorder"),
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

export class XComicSettingsForm extends Form {
  private contentRatings: ContentPreferenceRating[];
  private contentTypes: SeriesType[];
  private excludedGenres: string[];
  private excludedTags: string[];
  private visibleSections: SectionId[];

  constructor(
    preferences: XComicPreferences,
    private readonly sectionOrder: SectionId[],
    visibleSections: SectionId[],
    private readonly filterOptions: FilterOptions,
  ) {
    super();
    this.contentRatings = preferences.contentRatings;
    this.contentTypes = preferences.types;
    this.excludedGenres = preferences.excludedGenres;
    this.excludedTags = preferences.excludedTags;
    this.visibleSections = visibleSections;
  }

  override getSections() {
    return [
      Section("content", [
        SelectRow("content_types", {
          title: "Content types",
          layout: "flow",
          value: this.contentTypes,
          items: TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: TYPE_OPTIONS.length,
          onValueChange: Application.Selector(this as XComicSettingsForm, "handleContentTypes"),
        }),
        SelectRow("content_ratings", {
          title: "Content ratings",
          layout: "flow",
          value: this.contentRatings,
          items: CONTENT_RATING_OPTIONS,
          minItemCount: 1,
          maxItemCount: CONTENT_RATING_OPTIONS.length,
          onValueChange: Application.Selector(this as XComicSettingsForm, "handleContentRatings"),
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
          onValueChange: Application.Selector(this as XComicSettingsForm, "handleExcludedGenres"),
        }),
        SelectRow("excluded_tags", {
          title: "Excluded tags",
          layout: "flow",
          value: this.excludedTags,
          items: this.filterOptions.formats,
          minItemCount: 0,
          maxItemCount: this.filterOptions.formats.length,
          onValueChange: Application.Selector(this as XComicSettingsForm, "handleExcludedTags"),
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
          onValueChange: Application.Selector(this as XComicSettingsForm, "handleVisibleSections"),
        }),
        NavigationRow("section_order", {
          title: "Section order",
          form: new XComicSectionOrderForm(this.sectionOrder),
        }),
      ]),
    ];
  }

  async handleContentTypes(value: string[]): Promise<void> {
    this.contentTypes = value as SeriesType[];
    Application.setState(this.contentTypes, STATE_KEYS.CONTENT_TYPES);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleContentRatings(value: string[]): Promise<void> {
    this.contentRatings = value as ContentPreferenceRating[];
    Application.setState(this.contentRatings, STATE_KEYS.CONTENT_RATINGS);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleExcludedGenres(value: string[]): Promise<void> {
    this.excludedGenres = value;
    Application.setState(value, STATE_KEYS.EXCLUDED_GENRES);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleExcludedTags(value: string[]): Promise<void> {
    this.excludedTags = value;
    Application.setState(value, STATE_KEYS.EXCLUDED_TAGS);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleVisibleSections(value: string[]): Promise<void> {
    this.visibleSections = value as SectionId[];
    Application.setState(this.visibleSections, STATE_KEYS.VISIBLE_SECTIONS);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
