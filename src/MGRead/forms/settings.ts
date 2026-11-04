/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, Form, Section, SelectRow, ToggleRow, type Tag } from "@paperback/types";

import { STATE_KEYS, type Preferences } from "../models";
export const getPreferences = (): Preferences => ({
  ratings: (Application.getState(STATE_KEYS.RATINGS) as string[] | undefined) ?? [
    ContentRating.EVERYONE,
    ContentRating.MATURE,
    ContentRating.ADULT,
  ],
  excludedGenres: (Application.getState(STATE_KEYS.GENRES) as string[] | undefined) ?? [],
  hideLocked: (Application.getState(STATE_KEYS.HIDE_LOCKED) as boolean | undefined) ?? false,
});
export class MGReadSettingsForm extends Form {
  private values = getPreferences();
  constructor(private readonly genres: Tag[]) {
    super();
  }
  override getSections() {
    return [
      Section("content", [
        SelectRow("ratings", {
          title: "Content ratings",
          value: this.values.ratings,
          items: [
            { id: ContentRating.EVERYONE, title: "Safe" },
            { id: ContentRating.MATURE, title: "Mature" },
            { id: ContentRating.ADULT, title: "Adult" },
          ],
          layout: "flow",
          minItemCount: 0,
          maxItemCount: 3,
          onValueChange: Application.Selector(this as MGReadSettingsForm, "handleRatings"),
        }),
        SelectRow("genres", {
          title: "Excluded genres",
          value: this.values.excludedGenres,
          items: this.genres,
          layout: "flow",
          minItemCount: 0,
          maxItemCount: this.genres.length,
          onValueChange: Application.Selector(this as MGReadSettingsForm, "handleGenres"),
        }),
        ToggleRow("hideLocked", {
          title: "Hide locked chapters",
          value: this.values.hideLocked,
          onValueChange: Application.Selector(this as MGReadSettingsForm, "handleLocked"),
        }),
      ]),
    ];
  }
  async handleRatings(value: string[]): Promise<void> {
    this.values.ratings = value;
    Application.setState(value, STATE_KEYS.RATINGS);
    Application.invalidateDiscoverSections();
  }
  async handleGenres(value: string[]): Promise<void> {
    this.values.excludedGenres = value;
    Application.setState(value, STATE_KEYS.GENRES);
    Application.invalidateDiscoverSections();
  }
  async handleLocked(value: boolean): Promise<void> {
    this.values.hideLocked = value;
    Application.setState(value, STATE_KEYS.HIDE_LOCKED);
  }
}
