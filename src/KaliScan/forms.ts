/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  InputRow,
  Section,
  SelectRow,
  SelectSection,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  DOMAIN,
  GENRE_MODE_OPTIONS,
  GENRES,
  MIRRORS,
  STATUS_OPTIONS,
  type SearchMetadata,
} from "./models";

const BASE_URL_KEY = "kaliscan.baseUrl";
const ACTIVE_BASE_URL_KEY = "kaliscan.activeBaseUrl";
const FAILOVER_KEY = "kaliscan.automaticFailover";
const MIRROR_IDS = new Set(MIRRORS.map((mirror) => mirror.id));

export const getSelectedBaseUrl = (): string => {
  const value = Application.getState(BASE_URL_KEY);
  return typeof value === "string" && MIRROR_IDS.has(value) ? value : DOMAIN;
};

export const getAutomaticFailover = (): boolean => Application.getState(FAILOVER_KEY) !== false;

export const getBaseUrl = (): string => {
  if (!getAutomaticFailover()) return getSelectedBaseUrl();
  const active = Application.getState(ACTIVE_BASE_URL_KEY);
  return typeof active === "string" && MIRROR_IDS.has(active) ? active : getSelectedBaseUrl();
};

export const setBaseUrl = (value: string): void => {
  const mirror = MIRROR_IDS.has(value) ? value : DOMAIN;
  Application.setState(mirror, BASE_URL_KEY);
  Application.setState(mirror, ACTIVE_BASE_URL_KEY);
  Application.invalidateDiscoverSections();
};

export const setActiveBaseUrl = (value: string): void => {
  if (getAutomaticFailover() && MIRROR_IDS.has(value)) {
    Application.setState(value, ACTIVE_BASE_URL_KEY);
  }
};

export class KaliScanSettingsForm extends Form {
  private baseUrl = getSelectedBaseUrl();
  private automaticFailover = getAutomaticFailover();

  override getSections() {
    return [
      Section(
        {
          id: "mirror",
          footer:
            "All four domains share the same catalog. Automatic failover rotates to another " +
            "mirror only when the selected site is blocked, unavailable, or returning a server error.",
        },
        [
          SelectRow("base_url", {
            title: "Preferred Mirror",
            layout: "list",
            value: [this.baseUrl],
            items: MIRRORS,
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(
              this as KaliScanSettingsForm,
              "handleBaseUrlChange",
            ),
          }),
          ToggleRow("automatic_failover", {
            title: "Automatic Mirror Failover",
            value: this.automaticFailover,
            onValueChange: Application.Selector(
              this as KaliScanSettingsForm,
              "handleAutomaticFailoverChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleBaseUrlChange(value: string[]): Promise<void> {
    this.baseUrl = value[0] ?? DOMAIN;
    setBaseUrl(this.baseUrl);
  }

  async handleAutomaticFailoverChange(value: boolean): Promise<void> {
    this.automaticFailover = value;
    Application.setState(value, FAILOVER_KEY);
    Application.setState(this.baseUrl, ACTIVE_BASE_URL_KEY);
    Application.invalidateDiscoverSections();
  }
}

export class KaliScanAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private author: string;
  private genres: Record<string, "included" | "excluded">;
  private genreMode: string[];

  private readonly statusOptions: Tag[] = STATUS_OPTIONS;
  private readonly genreOptions: Tag[] = GENRES.map((genre) => ({
    id: genre.id,
    title: genre.value,
  }));

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.status = meta.status ?? [];
    this.author = meta.author ?? "";
    this.genres = { ...meta.genres };
    this.genreMode = meta.genreMode ?? ["and"];
  }

  override getSections() {
    return [
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.status,
          items: this.statusOptions,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as KaliScanAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section("author", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as KaliScanAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include, twice to exclude." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as KaliScanAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      SelectSection(this, {
        id: "genre_mode",
        layout: "flow",
        value: this.genreMode,
        items: GENRE_MODE_OPTIONS,
        minItemCount: 1,
        maxItemCount: 1,
      }),
    ];
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.status.length > 0) result.status = this.status;
    if (this.author.trim()) result.author = this.author.trim();
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    if (this.genreMode.length > 0) result.genreMode = this.genreMode;
    return result;
  }
}
