/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, ToggleRow, TriStateSelectRow, type Tag } from "@paperback/types";

import type { TriState } from "../models";

const STATE_KEYS = {
  hideAdult: "novelarchive_hide_adult",
  genres: "novelarchive_genres",
} as const;

// Defaults off — NovelArchive is an adult-rated source, so adult titles show
// unless the user opts to hide them (the app's global filter still applies).
export const getHideAdultContent = (): boolean =>
  (Application.getState(STATE_KEYS.hideAdult) as boolean | undefined) ?? false;

export const getDefaultGenres = (): TriState =>
  (Application.getState(STATE_KEYS.genres) as TriState | undefined) ?? {};

export class NovelArchiveSettingsForm extends Form {
  private hideAdultContent = getHideAdultContent();
  private genres = getDefaultGenres();

  private readonly genreOptions: Tag[];

  constructor(genres: Tag[]) {
    super();
    this.genreOptions = genres;
  }

  override getSections() {
    return [
      Section(
        {
          id: "browse",
          header: "Browse Settings",
          footer: "Used as defaults for browse and search.",
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
          TriStateSelectRow("genres", {
            title: "Default genres",
            layout: "flow",
            value: this.genres,
            items: this.genreOptions,
            allowExclusion: true,
            allowEmptySelection: true,
            onValueChange: Application.Selector(
              this as NovelArchiveSettingsForm,
              "handleGenresChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleHideAdultChange(value: boolean): Promise<void> {
    this.hideAdultContent = value;
    Application.setState(value, STATE_KEYS.hideAdult);
    Application.invalidateDiscoverSections();
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
    Application.setState(value, STATE_KEYS.genres);
    Application.invalidateDiscoverSections();
  }
}
