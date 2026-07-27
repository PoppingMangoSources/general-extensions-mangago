/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, ToggleRow } from "@paperback/types";

import { STATE_KEYS } from "../models";

export const getShowLockedChapters = (): boolean =>
  (Application.getState(STATE_KEYS.SHOW_LOCKED_CHAPTERS) as boolean | undefined) ?? false;

export class StoneScapeSettingsForm extends Form {
  private showLockedChapters = getShowLockedChapters();

  override getSections() {
    return [
      Section(
        {
          id: "chapters",
          header: "Chapter Settings",
          footer: "Locked chapters must be unlocked on the website before reading.",
        },
        [
          ToggleRow("show_locked", {
            title: "Show locked chapters",
            value: this.showLockedChapters,
            onValueChange: Application.Selector(
              this as StoneScapeSettingsForm,
              "handleShowLockedChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleShowLockedChange(value: boolean): Promise<void> {
    this.showLockedChapters = value;
    Application.setState(value, STATE_KEYS.SHOW_LOCKED_CHAPTERS);
  }
}
