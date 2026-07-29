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
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import {
  COMPLETED_OPTIONS,
  DEMOGRAPHICS,
  GENRES,
  SECTION_OPTIONS,
  STATE_KEYS,
  type SearchMetadata,
  type SectionId,
  type TriState,
} from "./models";

export const getSectionOrder = (): SectionId[] => {
  const validIds = SECTION_OPTIONS.map((section) => section.id as SectionId);
  const stored = (Application.getState(STATE_KEYS.SECTION_ORDER) as SectionId[] | undefined) ?? [];
  const order = [...new Set(stored.filter((id) => validIds.includes(id)))];
  return [...order, ...validIds.filter((id) => !order.includes(id))];
};

export const getVisibleSections = (): SectionId[] => {
  const validIds = SECTION_OPTIONS.map((section) => section.id as SectionId);
  const stored = Application.getState(STATE_KEYS.VISIBLE_SECTIONS) as SectionId[] | undefined;
  const visible = stored?.filter((id) => validIds.includes(id)) ?? [];
  return visible.length > 0 ? visible : validIds;
};

export class MangaTownSectionOrderForm extends Form {
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
        onReorder: Application.Selector(this as MangaTownSectionOrderForm, "handleReorder"),
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

export class MangaTownSettingsForm extends Form {
  private visibleSections: SectionId[];

  constructor() {
    super();
    this.visibleSections = getVisibleSections();
  }

  override getSections() {
    return [
      Section("discover", [
        SelectRow("visible_sections", {
          title: "Visible sections",
          layout: "list",
          value: this.visibleSections,
          items: SECTION_OPTIONS,
          minItemCount: 1,
          maxItemCount: SECTION_OPTIONS.length,
          onValueChange: Application.Selector(
            this as MangaTownSettingsForm,
            "handleVisibleSectionsChange",
          ),
        }),
        NavigationRow("section_order", {
          title: "Section order",
          form: new MangaTownSectionOrderForm(getSectionOrder()),
        }),
      ]),
    ];
  }

  async handleVisibleSectionsChange(value: string[]): Promise<void> {
    this.visibleSections = value as SectionId[];
    Application.setState(this.visibleSections, STATE_KEYS.VISIBLE_SECTIONS);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}

export class MangaTownAdvancedSearchForm extends AdvancedSearchForm {
  private genres: TriState;
  private demographic: string[];
  private completed: string[];
  private author: string;
  private artist: string;

  constructor(query: SearchQuery<SearchMetadata>) {
    super();
    const metadata = query.metadata ?? {};
    this.genres = { ...metadata.genres };
    this.demographic = metadata.demographic ?? [];
    this.completed = metadata.completed ?? ["all"];
    this.author = metadata.author ?? "";
    this.artist = metadata.artist ?? "";
  }

  override getSections() {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: GENRES,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as MangaTownAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section("demographic", [
        SelectRow("demographic", {
          title: "Demographic",
          layout: "flow",
          value: this.demographic,
          items: DEMOGRAPHICS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaTownAdvancedSearchForm,
            "handleDemographicChange",
          ),
        }),
      ]),
      Section("credits", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as MangaTownAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector(
            this as MangaTownAdvancedSearchForm,
            "handleArtistChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("completed", {
          title: "Completion status",
          layout: "flow",
          value: this.completed,
          items: COMPLETED_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaTownAdvancedSearchForm,
            "handleCompletedChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleDemographicChange(value: string[]): Promise<void> {
    this.demographic = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleArtistChange(value: string): Promise<void> {
    this.artist = value;
  }

  async handleCompletedChange(value: string[]): Promise<void> {
    this.completed = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (this.demographic.length > 0) metadata.demographic = this.demographic;
    if (this.completed[0] && this.completed[0] !== "all") metadata.completed = this.completed;
    if (this.author.trim()) metadata.author = this.author.trim();
    if (this.artist.trim()) metadata.artist = this.artist.trim();
    return metadata;
  }
}
