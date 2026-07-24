/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { Form, Section, ToggleRow } from "@paperback/types";

const SHOW_PAID_KEY = "luacomic.showPaidChapters";
const SHOW_ADULT_KEY = "luacomic.showAdultContent";

export const getShowPaidChapters = (): boolean => Application.getState(SHOW_PAID_KEY) === true;

export const getShowAdultContent = (): boolean => Application.getState(SHOW_ADULT_KEY) !== false;

export class LuaComicSettingsForm extends Form {
  override getSections() {
    return [
      Section("chapters", [
        ToggleRow("showPaid", {
          title: "Show paid chapters",
          subtitle: "Shows coin chapters with a 🔒. Unlock them on the website before reading.",
          value: getShowPaidChapters(),
          onValueChange: Application.Selector(this as LuaComicSettingsForm, "handleShowPaidChange"),
        }),
      ]),
      Section("content", [
        ToggleRow("showAdult", {
          title: "Show adult content",
          subtitle: "Includes adult series in browse and search results.",
          value: getShowAdultContent(),
          onValueChange: Application.Selector(
            this as LuaComicSettingsForm,
            "handleShowAdultChange",
          ),
        }),
      ]),
    ];
  }

  async handleShowPaidChange(value: boolean): Promise<void> {
    Application.setState(value, SHOW_PAID_KEY);
  }

  async handleShowAdultChange(value: boolean): Promise<void> {
    Application.setState(value, SHOW_ADULT_KEY);
  }
}
