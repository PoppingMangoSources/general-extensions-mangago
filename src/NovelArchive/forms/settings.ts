/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, SelectRow, ToggleRow, TriStateSelectRow, type Tag } from "@paperback/types";

import { AI_OPTIONS, GENRES, type OptionItem, type TriState } from "../models";

const STATE_KEYS = {
  hideAdult: "novelarchive_hide_adult",
  aiMode: "novelarchive_ai_mode",
  genres: "novelarchive_genres",
} as const;

export const getHideAdultContent = (): boolean =>
  (Application.getState(STATE_KEYS.hideAdult) as boolean | undefined) ?? true;

export const getDefaultAiMode = (): string =>
  (Application.getState(STATE_KEYS.aiMode) as string | undefined) ?? "include";

export const getDefaultGenres = (): TriState =>
  (Application.getState(STATE_KEYS.genres) as TriState | undefined) ?? {};

export const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

export class NovelArchiveSettingsForm extends Form {
  private hideAdultContent = getHideAdultContent();
  private aiMode = [getDefaultAiMode()];
  private genres = getDefaultGenres();

  private readonly aiOptions: Tag[] = toTags(AI_OPTIONS);
  private readonly genreOptions: Tag[] = toTags(GENRES);

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
      Section({ id: "ai", footer: "Default handling of AI-written novels everywhere." }, [
        SelectRow("ai", {
          title: "AI generated",
          layout: "flow",
          value: this.aiMode,
          items: this.aiOptions,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as NovelArchiveSettingsForm, "handleAiChange"),
        }),
      ]),
      Section(
        {
          id: "genres",
          footer: "Always include or exclude these genres. Tap once to include, twice to exclude.",
        },
        [
          TriStateSelectRow("genres", {
            title: "Genres",
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
    // These preferences drive the discover/genre queries, so drop the cached sections.
    Application.invalidateDiscoverSections();
  }

  async handleAiChange(value: string[]): Promise<void> {
    this.aiMode = value;
    if (value.length > 0) Application.setState(value[0], STATE_KEYS.aiMode);
    Application.invalidateDiscoverSections();
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
    Application.setState(value, STATE_KEYS.genres);
    Application.invalidateDiscoverSections();
  }
}
