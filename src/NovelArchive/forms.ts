/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  GENRE_MATCH_OPTIONS,
  GENRES,
  STATUS_OPTIONS,
  type OptionItem,
  type SearchMetadata,
  type TriState,
} from "./models";

const HIDE_ADULT_KEY = "novelarchive.hideAdultContent";

export const getHideAdultContent = (): boolean => Application.getState(HIDE_ADULT_KEY) !== false;

export const setHideAdultContent = (value: boolean): void => {
  Application.setState(value, HIDE_ADULT_KEY);
};

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

export class NovelArchiveSettingsForm extends Form {
  private hideAdultContent = getHideAdultContent();

  override getSections() {
    return [
      Section(
        {
          id: "content",
          footer: "Hides adult, smut and explicit titles from discover and search.",
        },
        [
          ToggleRow("hide_adult", {
            title: "Hide adult content",
            value: this.hideAdultContent,
            onValueChange: Application.Selector(
              this as NovelArchiveSettingsForm,
              "handleHideAdultChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleHideAdultChange(value: boolean): Promise<void> {
    this.hideAdultContent = value;
    setHideAdultContent(value);
  }
}

export class NovelArchiveAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private genreMatch: string[];
  private genres: TriState;

  private readonly statusOptions: Tag[] = toTags(STATUS_OPTIONS);
  private readonly genreMatchOptions: Tag[] = toTags(GENRE_MATCH_OPTIONS);
  private readonly genreOptions: Tag[] = toTags(GENRES);

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.status = meta.status ?? [];
    this.genreMatch = meta.genreMatch ?? ["all"];
    this.genres = { ...meta.genres };
  }

  override getSections() {
    return [
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelArchiveAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as NovelArchiveAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
        SelectRow("genre_match", {
          title: "Match",
          layout: "flow",
          value: this.genreMatch,
          items: this.genreMatchOptions,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelArchiveAdvancedSearchForm,
            "handleGenreMatchChange",
          ),
        }),
      ]),
    ];
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleGenreMatchChange(value: string[]): Promise<void> {
    this.genreMatch = value;
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.status.length > 0) result.status = this.status;
    if (this.genreMatch.length > 0) result.genreMatch = this.genreMatch;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    return result;
  }
}
