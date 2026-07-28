/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  EditSection,
  Form,
  LabelRow,
  NavigationRow,
  Section,
  SelectRow,
  type Tag,
} from "@paperback/types";

import { SECTION_OPTIONS, type SectionId } from "../discover-section-providing/models";
import {
  STATE_KEYS,
  type ChikariPreferences,
  type ContentPreferenceRating,
  type SeriesType,
} from "../shared/models";
import { CONTENT_RATING_OPTIONS, CONTENT_TYPE_OPTIONS } from "./models";

export class ChikariSectionOrderForm extends Form {
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
        onReorder: Application.Selector(this as ChikariSectionOrderForm, "handleReorder"),
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

export class ChikariSettingsForm extends Form {
  private contentRatings: ContentPreferenceRating[];
  private contentTypes: SeriesType[];
  private excludedGenres: string[];
  private excludedTags: string[];
  private visibleSections: SectionId[];

  constructor(
    private readonly genreOptions: Tag[],
    private readonly tagOptions: Tag[],
    preferences: ChikariPreferences,
    private readonly sectionOrder: SectionId[],
    visibleSections: SectionId[],
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
          items: CONTENT_TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: CONTENT_TYPE_OPTIONS.length,
          onValueChange: Application.Selector(
            this as ChikariSettingsForm,
            "handleContentTypesChange",
          ),
        }),
        SelectRow("content_ratings", {
          title: "Content ratings",
          layout: "flow",
          value: this.contentRatings,
          items: CONTENT_RATING_OPTIONS,
          minItemCount: 1,
          maxItemCount: CONTENT_RATING_OPTIONS.length,
          onValueChange: Application.Selector(
            this as ChikariSettingsForm,
            "handleContentRatingsChange",
          ),
        }),
      ]),
      Section("exclusions", [
        SelectRow("excluded_genres", {
          title: "Excluded genres",
          layout: "flow",
          value: this.excludedGenres,
          items: this.genreOptions,
          minItemCount: 0,
          maxItemCount: this.genreOptions.length,
          onValueChange: Application.Selector(
            this as ChikariSettingsForm,
            "handleExcludedGenresChange",
          ),
        }),
        SelectRow("excluded_tags", {
          title: "Excluded tags",
          layout: "flow",
          value: this.excludedTags,
          items: this.tagOptions,
          minItemCount: 0,
          maxItemCount: this.tagOptions.length,
          onValueChange: Application.Selector(
            this as ChikariSettingsForm,
            "handleExcludedTagsChange",
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
            this as ChikariSettingsForm,
            "handleVisibleSectionsChange",
          ),
        }),
        NavigationRow("section_order", {
          title: "Section order",
          form: new ChikariSectionOrderForm(this.sectionOrder),
        }),
      ]),
    ];
  }

  async handleContentTypesChange(value: string[]): Promise<void> {
    this.contentTypes = value as SeriesType[];
    Application.setState(this.contentTypes, STATE_KEYS.CONTENT_TYPES);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleContentRatingsChange(value: string[]): Promise<void> {
    this.contentRatings = value as ContentPreferenceRating[];
    Application.setState(this.contentRatings, STATE_KEYS.CONTENT_RATINGS);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleExcludedGenresChange(value: string[]): Promise<void> {
    this.excludedGenres = value;
    Application.setState(value, STATE_KEYS.EXCLUDED_GENRES);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleExcludedTagsChange(value: string[]): Promise<void> {
    this.excludedTags = value;
    Application.setState(value, STATE_KEYS.EXCLUDED_TAGS);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleVisibleSectionsChange(value: string[]): Promise<void> {
    this.visibleSections = value as SectionId[];
    Application.setState(this.visibleSections, STATE_KEYS.VISIBLE_SECTIONS);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
