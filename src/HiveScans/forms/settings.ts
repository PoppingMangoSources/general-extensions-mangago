/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, ToggleRow } from "@paperback/types";

const SHOW_LOCKED_KEY = "show_locked_chapters";

export function getShowLockedChapters(): boolean {
  return (Application.getState(SHOW_LOCKED_KEY) ?? false) as boolean;
}

export class HiveScansSettingsForm extends Form {
  override getSections() {
    return [
      Section("chapters", [
        ToggleRow("showLocked", {
          title: "Show locked chapters",
          subtitle:
            "List paid/locked chapters (marked with 🔒). They still require an unlock on the website to read.",
          value: getShowLockedChapters(),
          onValueChange: Application.Selector(
            this as HiveScansSettingsForm,
            "handleShowLockedChange",
          ),
        }),
      ]),
    ];
  }

  async handleShowLockedChange(value: boolean): Promise<void> {
    Application.setState(value, SHOW_LOCKED_KEY);
  }
}
