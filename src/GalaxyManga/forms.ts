/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  EditSection,
  Form,
  LabelRow,
  NavigationRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  SECTION_OPTIONS,
  STATE_KEYS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
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

export class GalaxyMangaSectionOrderForm extends Form {
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
        onReorder: Application.Selector(this as GalaxyMangaSectionOrderForm, "handleReorder"),
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

export class GalaxyMangaSettingsForm extends Form {
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
            this as GalaxyMangaSettingsForm,
            "handleVisibleSectionsChange",
          ),
        }),
        NavigationRow("section_order", {
          title: "Section order",
          form: new GalaxyMangaSectionOrderForm(getSectionOrder()),
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

export class GalaxyMangaAdvancedSearchForm extends AdvancedSearchForm {
  private genres: TriState;
  private statuses: string[];
  private types: string[];

  constructor(
    query: SearchQuery<SearchMetadata>,
    private readonly genreOptions: Tag[],
  ) {
    super();
    const metadata = query.metadata ?? {};
    this.genres = { ...metadata.genres };
    this.statuses = metadata.statuses ?? [""];
    this.types = metadata.types ?? [""];
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
          onValueChange: Application.Selector(
            this as GalaxyMangaAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.statuses,
          items: STATUS_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as GalaxyMangaAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
      ]),
      Section("type", [
        SelectRow("type", {
          title: "Type",
          layout: "flow",
          value: this.types,
          items: TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as GalaxyMangaAdvancedSearchForm,
            "handleTypesChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }

  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (this.statuses[0]) metadata.statuses = this.statuses;
    if (this.types[0]) metadata.types = this.types;
    return metadata;
  }
}
