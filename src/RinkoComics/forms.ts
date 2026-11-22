/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
  type TagSection,
} from "@paperback/types";

import type { SearchMetadata } from "./models";

const HIDE_LOCKED_KEY = "hide_paid_chapters";

export const getHideLocked = (): boolean => {
  return (Application.getState(HIDE_LOCKED_KEY) as boolean | undefined) ?? false;
};

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
    Application.invalidateDiscoverSections();
  }
}

export class RinkoComicsAdvancedSearchForm extends AdvancedSearchForm {
  private type: string[];
  private readonly genreOptions: Tag[];
  private genres: Record<string, "included" | "excluded">;

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreSection: TagSection) {
    super();
    this.type = searchQuery.metadata?.type ?? ["comic"];
    this.genreOptions = genreSection.tags;
    this.genres = { ...searchQuery.metadata?.genres };
  }

  override getSections() {
    if (this.genreOptions.length === 0) {
      return [
        Section("genres", [
          LabelRow("genresUnavailable", {
            title: "Genres unavailable",
            subtitle: "Genres could not be loaded. Pull to refresh and try again.",
          }),
        ]),
      ];
    }

    return [
      Section("contentType", [
        SelectRow("type", {
          title: "Type",
          layout: "flow",
          items: [
            { id: "comic", title: "Comics" },
            { id: "novel", title: "Novels" },
          ],
          value: this.type,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as RinkoComicsAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),
      ]),
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          // The site's filter takes included genres only.
          allowExclusion: false,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as RinkoComicsAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
    ];
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    return {
      type: this.type,
      ...(Object.keys(this.genres).length > 0 ? { genres: this.genres } : {}),
    };
  }
}
