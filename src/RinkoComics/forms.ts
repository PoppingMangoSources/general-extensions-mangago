/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  Section,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
  type TagSection,
} from "@paperback/types";

import type { SearchMetadata } from "./models";

const HIDE_LOCKED_KEY = "hide_paid_chapters";

export function getHideLocked(): boolean {
  return (Application.getState(HIDE_LOCKED_KEY) ?? false) as boolean;
}

export class RinkoComicsSettingsForm extends Form {
  override getSections() {
    return [
      Section("content", [
        ToggleRow("hideLocked", {
          title: "Hide paid chapters",
          subtitle: "Hide locked/paid chapters from the chapter list.",
          value: getHideLocked(),
          onValueChange: Application.Selector(
            this as RinkoComicsSettingsForm,
            "handleHideLockedChange",
          ),
        }),
      ]),
    ];
  }

  async handleHideLockedChange(value: boolean): Promise<void> {
    Application.setState(value, HIDE_LOCKED_KEY);
  }
}

export class RinkoComicsAdvancedSearchForm extends AdvancedSearchForm {
  private readonly genreOptions: Tag[] = [];
  private genres: Record<string, "included" | "excluded">;

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreSection: TagSection) {
    super();
    this.genreOptions = genreSection.tags;
    this.genres = { ...searchQuery.metadata?.genres };
  }

  override getSections() {
    if (this.genreOptions.length === 0) {
      return [
        Section("genres", [
          ToggleRow("genresUnavailable", {
            title: "Genres unavailable",
            subtitle: "Genres could not be loaded. Pull to refresh and try again.",
            value: false,
            onValueChange: Application.Selector(
              this as RinkoComicsAdvancedSearchForm,
              "handleNoop",
            ),
          }),
        ]),
      ];
    }

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
            this as RinkoComicsAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  async handleNoop(): Promise<void> {}

  override getSearchQueryMetadata(): SearchMetadata {
    return Object.keys(this.genres).length > 0 ? { genres: this.genres } : {};
  }
}
