/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, LabelRow, Section, ToggleRow } from "@paperback/types";

function toBoolean(value: unknown): boolean {
  return (value ?? false) === "true";
}

export function getUsePostIds(): boolean {
  return toBoolean(Application.getState("postIds"));
}

export function setUsePostIds(value: boolean): void {
  Application.setState(value.toString(), "postIds");
}

export function clearTags(): void {
  Application.setState(undefined, "tags");
}

export class MangaStreamSettings extends Form {
  name: string;
  constructor(name: string) {
    super();
    this.name = name;
  }

  override getSections() {
    return [
      Section(`${this.name} Settings`.replaceAll(" ", ""), [
        ToggleRow("postIds", {
          title: "Use Post IDs",
          value: getUsePostIds(),
          onValueChange: Application.Selector(this as MangaStreamSettings, "usePostIdsChange"),
        }),
        LabelRow("label", {
          title: "",
          subtitle:
            "Enabling will make the source slower, but more reliable!\nCHANGING THIS OPTION WILL ERASE YOUR READING PROGRESS FOR THIS SOURCE!",
        }),
      ]),
      Section("second", [
        ButtonRow("clearTags", {
          title: "Clear Cached Search Tags",
          onSelect: Application.Selector(this as MangaStreamSettings, "tagsChange"),
        }),
        ButtonRow("resetState", {
          title: "Reset All State",
          onSelect: Application.Selector(this as MangaStreamSettings, "resetState"),
        }),
        LabelRow("resetStateLabel", {
          title: "",
          subtitle:
            "Clicking this will reset all state for this extension. Do not click unless you know what you are doing.",
        }),
      ]),
    ];
  }

  async usePostIdsChange(value: boolean): Promise<void> {
    setUsePostIds(value);
  }

  async tagsChange(): Promise<void> {
    clearTags();
  }

  async resetState(): Promise<void> {
    Application.resetAllState();
  }
}
