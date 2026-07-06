/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
} from "@paperback/types";

const BASE_URL_KEY = "kingofshojo.baseUrlOverride";
const SHOW_ADULT_KEY = "kingofshojo.showAdultContent";
const IMAGE_MODE_KEY = "kingofshojo.imageMode";

// Reader images are served full-resolution from the site's CDN, which is slow on
// mobile data. "fast"/"saver" route them through the site's own image CDN
// (Jetpack Photon) resized + WebP-compressed; "original" leaves them untouched.
export function getImageMode(): string {
  const value = Application.getState(IMAGE_MODE_KEY);
  return typeof value === "string" ? value : "fast";
}

// Off by default: adult-tagged titles are hidden from search/browse and the
// featured hero until the reader opts in.
export function getShowAdultContent(): boolean {
  return (Application.getState(SHOW_ADULT_KEY) ?? false) as boolean;
}

// These sites rotate domains often; let users point at the new one without
// waiting for an extension update.
export function getBaseUrlOverride(): string | undefined {
  const value = Application.getState(BASE_URL_KEY);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function setBaseUrlOverride(value: string): void {
  Application.setState(value.trim().replace(/\/+$/, ""), BASE_URL_KEY);
}

export class KingOfShojoSettingsForm extends Form {
  private override: string;

  constructor(private readonly defaultBaseUrl: string) {
    super();
    this.override = getBaseUrlOverride() ?? "";
  }

  async updateOverride(value: string): Promise<void> {
    this.override = value;
    setBaseUrlOverride(value);
    this.reloadForm();
  }

  async resetOverride(): Promise<void> {
    this.override = "";
    setBaseUrlOverride("");
    this.reloadForm();
  }

  override getSections() {
    const effective =
      this.override.trim().length > 0
        ? this.override.trim().replace(/\/+$/, "")
        : this.defaultBaseUrl;

    return [
      Section(
        {
          id: "base_url",
          footer:
            "Override the site address if this source has moved to a new domain. " +
            `Leave empty to use the default. Include the scheme, e.g. ${this.defaultBaseUrl}`,
        },
        [
          InputRow("base_url_input", {
            title: "Base URL",
            value: this.override,
            onValueChange: Application.Selector(this as KingOfShojoSettingsForm, "updateOverride"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: effective }),
          ButtonRow("base_url_reset", {
            title: "Reset to default",
            onSelect: Application.Selector(this as KingOfShojoSettingsForm, "resetOverride"),
          }),
        ],
      ),
      Section(
        {
          id: "content",
          footer:
            "When off, adult-tagged titles are hidden from search, browse and " +
            "popular lists. Turn on to include them.",
        },
        [
          ToggleRow("show_adult", {
            title: "Show adult content",
            value: getShowAdultContent(),
            onValueChange: Application.Selector(
              this as KingOfShojoSettingsForm,
              "handleShowAdultChange",
            ),
          }),
        ],
      ),
      Section(
        {
          id: "images",
          footer:
            "Reader pages are served full-size and can be slow to load. Faster / " +
            "Data saver resize and compress them through the site's image CDN. If " +
            "pages fail to load, switch back to Original.",
        },
        [
          SelectRow("image_mode", {
            title: "Image loading",
            layout: "list",
            value: [getImageMode()],
            minItemCount: 1,
            maxItemCount: 1,
            items: [
              { id: "fast", title: "Faster (recommended)" },
              { id: "saver", title: "Data saver (smallest)" },
              { id: "original", title: "Original (full quality)" },
            ],
            onValueChange: Application.Selector(
              this as KingOfShojoSettingsForm,
              "handleImageModeChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleShowAdultChange(value: boolean): Promise<void> {
    Application.setState(value, SHOW_ADULT_KEY);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleImageModeChange(value: string[]): Promise<void> {
    Application.setState(value[0] ?? "fast", IMAGE_MODE_KEY);
    this.reloadForm();
  }
}