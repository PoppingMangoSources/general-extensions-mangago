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
  GENRE_MATCH_OPTIONS,
  GENRES,
  SECTION_OPTIONS,
  STATE_KEYS,
  STATUS_OPTIONS,
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

export class MvlempyrSectionOrderForm extends Form {
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
        onReorder: Application.Selector(this as MvlempyrSectionOrderForm, "handleReorder"),
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

export class MvlempyrSettingsForm extends Form {
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
            this as MvlempyrSettingsForm,
            "handleVisibleSectionsChange",
          ),
        }),
        NavigationRow("section_order", {
          title: "Section order",
          form: new MvlempyrSectionOrderForm(getSectionOrder()),
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

export class MvlempyrAdvancedSearchForm extends AdvancedSearchForm {
  private genres: TriState;
  private genreMatch: string[];
  private statuses: string[];
  private author: string;
  private minChapters: string;
  private maxChapters: string;

  constructor(query: SearchQuery<SearchMetadata>) {
    super();
    const metadata = query.metadata ?? {};
    this.genres = { ...metadata.genres };
    this.genreMatch = metadata.genreMatch ?? ["and"];
    this.statuses = metadata.statuses ?? ["all"];
    this.author = metadata.author ?? "";
    this.minChapters = metadata.minChapters ?? "";
    this.maxChapters = metadata.maxChapters ?? "";
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
            this as MvlempyrAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
        SelectRow("genre_match", {
          title: "Genre match",
          layout: "flow",
          value: this.genreMatch,
          items: GENRE_MATCH_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MvlempyrAdvancedSearchForm,
            "handleGenreMatchChange",
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
            this as MvlempyrAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
      ]),
      Section("details", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as MvlempyrAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        InputRow("min_chapters", {
          title: "Chapters from",
          value: this.minChapters,
          onValueChange: Application.Selector(
            this as MvlempyrAdvancedSearchForm,
            "handleMinChaptersChange",
          ),
        }),
        InputRow("max_chapters", {
          title: "Chapters to",
          value: this.maxChapters,
          onValueChange: Application.Selector(
            this as MvlempyrAdvancedSearchForm,
            "handleMaxChaptersChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleGenreMatchChange(value: string[]): Promise<void> {
    this.genreMatch = value;
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleMinChaptersChange(value: string): Promise<void> {
    this.minChapters = value;
  }

  async handleMaxChaptersChange(value: string): Promise<void> {
    this.maxChapters = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (this.genreMatch[0] === "or") metadata.genreMatch = this.genreMatch;
    if (this.statuses[0] && this.statuses[0] !== "all") metadata.statuses = this.statuses;
    if (this.author.trim()) metadata.author = this.author.trim();
    if (this.minChapters.trim()) metadata.minChapters = this.minChapters.trim();
    if (this.maxChapters.trim()) metadata.maxChapters = this.maxChapters.trim();
    return metadata;
  }
}
