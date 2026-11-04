/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, Section, SelectRow, ToggleRow } from "@paperback/types";

import {
  CONTENT_TYPE_OPTIONS,
  DEFAULT_OFF_SECTION_IDS,
  DISCOVER_SECTION_OPTIONS,
  GENRE_OPTIONS,
} from "../models";

const discoverSectionStateKey = (sectionId: string): string =>
  `mangago_discover_section_${sectionId}`;

export function getDiscoverSectionEnabled(sectionId: string): boolean {
  const stored = Application.getState(discoverSectionStateKey(sectionId)) as boolean | undefined;
  return stored ?? !DEFAULT_OFF_SECTION_IDS.has(sectionId);
}

function setDiscoverSectionEnabled(sectionId: string, enabled: boolean): void {
  Application.setState(enabled, discoverSectionStateKey(sectionId));
}

function resetDiscoverSectionSettings(): void {
  for (const section of DISCOVER_SECTION_OPTIONS) {
    Application.setState(undefined, discoverSectionStateKey(section.id));
  }
}

export function getHiddenGenreIds(): string[] {
  return (Application.getState("mangago_hidden_genres") as string[] | undefined) ?? [];
}

function setHiddenGenreIds(ids: string[]): void {
  Application.setState(ids, "mangago_hidden_genres");
}

export function getContentType(): string {
  return (Application.getState("mangago_content_type") as string | undefined) ?? "all";
}

function setContentType(value: string): void {
  Application.setState(value, "mangago_content_type");
}

function resetMangagoFilters(): void {
  Application.setState(undefined, "mangago_hidden_genres");
  Application.setState(undefined, "mangago_content_type");
}

export class MangagoSettingsForm extends Form {
  override getSections() {
    return [
      Section(
        {
          id: "discover_sections",
          header: "Home Sections",
        },
        DISCOVER_SECTION_OPTIONS.map((section) =>
          ToggleRow(section.id, {
            title: section.title,
            value: getDiscoverSectionEnabled(section.id),
            onValueChange: Application.Selector(
              this as MangagoSettingsForm,
              `handle_${section.id}` as never,
            ),
          }),
        ),
      ),
      Section(
        {
          id: "filters",
          footer:
            "Hidden genres are excluded from discover and genre browsing (not free-text search).",
        },
        [
          SelectRow("hide_genres", {
            title: "Hide Genres",
            subtitle: "Exclude selected genres",
            layout: "list",
            value: getHiddenGenreIds(),
            items: GENRE_OPTIONS.map((genre) => ({ id: genre.id, title: genre.title })),
            minItemCount: 0,
            maxItemCount: GENRE_OPTIONS.length,
            onValueChange: Application.Selector(this as MangagoSettingsForm, "handleHideGenres"),
          }),
          SelectRow("content_type", {
            title: "Content Type",
            subtitle: "Show only this type",
            layout: "list",
            value: [getContentType()],
            items: CONTENT_TYPE_OPTIONS.map((type) => ({ id: type.id, title: type.title })),
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as MangagoSettingsForm, "handleContentType"),
          }),
        ],
      ),
      Section("reset", [
        ButtonRow("resetDiscoverSections", {
          title: "Reset Home Sections",
          onSelect: Application.Selector(
            this as MangagoSettingsForm,
            "handleResetDiscoverSections",
          ),
        }),
        ButtonRow("resetFilters", {
          title: "Reset Filters",
          onSelect: Application.Selector(this as MangagoSettingsForm, "handleResetFilters"),
        }),
      ]),
    ];
  }

  constructor() {
    super();
    for (const section of DISCOVER_SECTION_OPTIONS) {
      (this as Record<string, unknown>)[`handle_${section.id}`] = async (
        enabled: boolean,
      ): Promise<void> => {
        setDiscoverSectionEnabled(section.id, enabled);
        Application.invalidateDiscoverSections();
      };
    }
  }

  async handleResetDiscoverSections(): Promise<void> {
    resetDiscoverSectionSettings();
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleHideGenres(ids: string[]): Promise<void> {
    setHiddenGenreIds(ids);
    Application.invalidateDiscoverSections();
  }

  async handleContentType(ids: string[]): Promise<void> {
    setContentType(ids[0] ?? "all");
    Application.invalidateDiscoverSections();
  }

  async handleResetFilters(): Promise<void> {
    resetMangagoFilters();
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
