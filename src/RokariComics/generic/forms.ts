/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  LabelRow,
  Section,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type TagSection,
} from "@paperback/types";

import { type MangaStreamFilterMetadata } from "./models";

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
  Application.setState(undefined, "tags");
};

export class MangaStreamAdvancedSearchForm extends AdvancedSearchForm {
  private genres: Record<string, "included" | "excluded">;
  private status: Record<string, "included" | "excluded">;
  private type: Record<string, "included" | "excluded">;
  private order: Record<string, "included" | "excluded">;

  constructor(
    query: SearchQuery<MangaStreamFilterMetadata>,
    private readonly tags: TagSection[],
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
      const handler =
        id === "genres"
          ? "handleGenresChange"
          : id === "status"
            ? "handleStatusChange"
            : id === "type"
              ? "handleTypeChange"
              : "handleOrderChange";
      return [
        Section(id, [
          TriStateSelectRow(id, {
            title: section.title,
            layout: "flow",
            value: this[id],
            items: section.tags,
            allowExclusion: false,
            allowEmptySelection: true,
            onValueChange: Application.Selector(this as MangaStreamAdvancedSearchForm, handler),
          }),
        ]),
      ];
    });
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  async handleStatusChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.status = value;
  }

  async handleTypeChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.type = value;
  }

  async handleOrderChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.order = value;
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
