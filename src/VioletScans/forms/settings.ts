/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, ToggleRow } from "@paperback/types";

import { STATE_KEYS, type StateKey } from "../models";

export const getShowLockedChapters = (): boolean =>
  (Application.getState(STATE_KEYS.SHOW_LOCKED_CHAPTERS satisfies StateKey) as
    | boolean
    | undefined) ?? false;

export class VioletScansSettingsForm extends Form {
  override getSections() {
    return [
      Section("chapters", [
        ToggleRow("show_locked_chapters", {
          title: "Show locked chapters",
          subtitle: "Include coin-locked chapters in chapter lists and Latest sections.",
          value: getShowLockedChapters(),
          onValueChange: Application.Selector(
            this as VioletScansSettingsForm,
            "handleShowLockedChaptersChange",
          ),
        }),
      ]),
    ];
  }

  async handleShowLockedChaptersChange(value: boolean): Promise<void> {
    Application.setState(value, STATE_KEYS.SHOW_LOCKED_CHAPTERS satisfies StateKey);
    Application.invalidateDiscoverSections();
  }
}
