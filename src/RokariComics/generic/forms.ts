/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type TagSection,
} from "@paperback/types";

import { SEARCH_TAGS_KEY, type MangaStreamFilterMetadata } from "./models";

const toBoolean = (value: unknown): boolean => {
  return (value ?? false) === "true";
};

export const getUsePostIds = (): boolean => {
  return toBoolean(Application.getState("postIds"));
};

export const setUsePostIds = (value: boolean): void => {
  Application.setState(value.toString(), "postIds");
};

export const clearTags = (): void => {
  Application.setState(undefined, SEARCH_TAGS_KEY);
};

export class MangaStreamAdvancedSearchForm extends AdvancedSearchForm {
  private genres: Record<string, "included" | "excluded">;
  private status: Record<string, "included" | "excluded">;
  private type: Record<string, "included" | "excluded">;
  private order: Record<string, "included" | "excluded">;

  constructor(
    query: SearchQuery<MangaStreamFilterMetadata>,
    private readonly tags: TagSection[],
    private readonly supportsGenreExclusion: boolean,
  ) {
    super();
    this.genres = { ...query.metadata?.genres };
    this.status = { ...query.metadata?.status };
    this.type = { ...query.metadata?.type };
    this.order = { ...query.metadata?.order };
  }

  override getSections() {
    return this.tags.flatMap((section) => {
      const id = section.id as "genres" | "status" | "type" | "order";
      if (!["genres", "status", "type", "order"].includes(id)) return [];
      if (id === "genres") {
        return [
          Section(id, [
            TriStateSelectRow(id, {
              title: section.title,
              layout: "flow",
              value: this.genres,
              items: section.tags,
              allowExclusion: this.supportsGenreExclusion,
              allowEmptySelection: true,
              onValueChange: Application.Selector(
                this as MangaStreamAdvancedSearchForm,
                "handleGenresChange",
              ),
            }),
          ]),
        ];
      }

      const handler =
        id === "status"
          ? "handleStatusChange"
          : id === "type"
            ? "handleTypeChange"
            : "handleOrderChange";
      return [
        Section(id, [
          SelectRow(id, {
            title: section.title,
            layout: "flow",
            value: Object.entries(this[id])
              .filter(([, state]) => state === "included")
              .map(([value]) => value),
            items: section.tags,
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as MangaStreamAdvancedSearchForm, handler),
          }),
        ]),
      ];
    });
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = Object.fromEntries(value.map((id) => [id, "included"] as const));
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = Object.fromEntries(value.map((id) => [id, "included"] as const));
  }

  async handleOrderChange(value: string[]): Promise<void> {
    this.order = Object.fromEntries(value.map((id) => [id, "included"] as const));
  }

  override getSearchQueryMetadata(): MangaStreamFilterMetadata {
    return {
      genres: this.genres,
      status: this.status,
      type: this.type,
      order: this.order,
    };
  }
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
