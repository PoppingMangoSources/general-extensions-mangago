/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, SelectRow, InputRow } from "@paperback/types";

import { STATE_KEYS, LANGUAGE_OPTIONS, CONTENT_OPTIONS, type Preferences } from "../models";
const names = (value: string): string[] => [
  ...new Set(
    value
      .split(/[,\n]/)
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  ),
];
export const getPreferences = (): Preferences => ({
  languages: (Application.getState(STATE_KEYS.LANGUAGES) as string[] | undefined) ?? ["en"],
  content: (Application.getState(STATE_KEYS.CONTENT) as string | undefined) ?? "all",
  chapterMode: (Application.getState(STATE_KEYS.CHAPTER_MODE) as string | undefined) ?? "group",
  preferred: names((Application.getState(STATE_KEYS.PREFERRED) as string | undefined) ?? ""),
  blocked: names((Application.getState(STATE_KEYS.BLOCKED) as string | undefined) ?? ""),
});
export class SwarmSettingsForm extends Form {
  private values = getPreferences();
  private preferred = (Application.getState(STATE_KEYS.PREFERRED) as string | undefined) ?? "";
  private blocked = (Application.getState(STATE_KEYS.BLOCKED) as string | undefined) ?? "";
  override getSections() {
    return [
      Section("content", [
        SelectRow("languages", {
          title: "Chapter languages",
          value: this.values.languages,
          items: LANGUAGE_OPTIONS,
          layout: "flow",
          minItemCount: 1,
          maxItemCount: LANGUAGE_OPTIONS.length,
          onValueChange: Application.Selector(this as SwarmSettingsForm, "handleLanguages"),
        }),
        SelectRow("content", {
          title: "Content rating",
          value: [this.values.content],
          items: CONTENT_OPTIONS,
          layout: "flow",
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as SwarmSettingsForm, "handleContent"),
        }),
      ]),
      Section("uploads", [
        SelectRow("chapterMode", {
          title: "Chapter list",
          value: [this.values.chapterMode],
          items: [
            { id: "all", title: "All uploads" },
            { id: "group", title: "One per uploader" },
            { id: "chapter", title: "One per chapter" },
          ],
          layout: "flow",
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as SwarmSettingsForm, "handleMode"),
        }),
        InputRow("preferred", {
          title: "Preferred uploaders (comma-separated)",
          value: this.preferred,
          onValueChange: Application.Selector(this as SwarmSettingsForm, "handlePreferred"),
        }),
        InputRow("blocked", {
          title: "Blocked uploaders (comma-separated)",
          value: this.blocked,
          onValueChange: Application.Selector(this as SwarmSettingsForm, "handleBlocked"),
        }),
      ]),
    ];
  }
  async handleLanguages(value: string[]): Promise<void> {
    this.values.languages = value;
    Application.setState(value, STATE_KEYS.LANGUAGES);
    Application.invalidateDiscoverSections();
  }
  async handleContent(value: string[]): Promise<void> {
    this.values.content = value[0] ?? "all";
    Application.setState(this.values.content, STATE_KEYS.CONTENT);
    Application.invalidateDiscoverSections();
  }
  async handleMode(value: string[]): Promise<void> {
    this.values.chapterMode = value[0] ?? "group";
    Application.setState(this.values.chapterMode, STATE_KEYS.CHAPTER_MODE);
  }
  async handlePreferred(value: string): Promise<void> {
    this.preferred = value;
    Application.setState(value, STATE_KEYS.PREFERRED);
  }
  async handleBlocked(value: string): Promise<void> {
    this.blocked = value;
    Application.setState(value, STATE_KEYS.BLOCKED);
  }
}
