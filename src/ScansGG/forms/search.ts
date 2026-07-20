/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  STATUS_OPTIONS,
  TAG_OPTIONS,
  TYPE_OPTIONS,
  type OptionItem,
  type SearchMetadata,
  type TagMatchMode,
  type TriStateSelection,
  type TriStateValue,
} from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

const TYPE_TAGS = toTags(TYPE_OPTIONS);
const STATUS_TAGS = toTags(STATUS_OPTIONS);
const TAG_TAGS = toTags(TAG_OPTIONS);
const TAG_MATCH_OPTIONS: Tag[] = [
  { id: "and", title: "AND" },
  { id: "or", title: "OR" },
];

export class ScansGGAdvancedSearchForm extends AdvancedSearchForm {
  private types: TriStateSelection;
  private statuses: TriStateSelection;
  private tags: TriStateSelection;
  private tagMatchMode: TagMatchMode[];

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.types = { ...meta.types };
    this.statuses = { ...meta.statuses };
    this.tags = { ...meta.tags };
    this.tagMatchMode = [meta.tagMatchMode ?? "and"];
  }

  override getSections() {
    return [
      Section("type", [
        TriStateSelectRow("types", {
          title: "Type",
          layout: "flow",
          value: this.types,
          items: TYPE_TAGS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as ScansGGAdvancedSearchForm,
            "handleTypesChange",
          ),
        }),
      ]),
      Section("status", [
        TriStateSelectRow("statuses", {
          title: "Status",
          layout: "flow",
          value: this.statuses,
          items: STATUS_TAGS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as ScansGGAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
      ]),
      Section("tags", [
        TriStateSelectRow("tags", {
          title: "Tags",
          layout: "flow",
          value: this.tags,
          items: TAG_TAGS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as ScansGGAdvancedSearchForm,
            "handleTagsChange",
          ),
        }),
      ]),
      Section(
        {
          id: "tag_match_mode",
          footer: "AND requires every included tag. OR requires at least one included tag.",
        },
        [
          SelectRow("tag_match_mode", {
            title: "Included Tags Match",
            layout: "flow",
            value: this.tagMatchMode,
            items: TAG_MATCH_OPTIONS,
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(
              this as ScansGGAdvancedSearchForm,
              "handleTagMatchModeChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleTypesChange(value: Record<string, TriStateValue>): Promise<void> {
    this.types = value;
  }

  async handleStatusesChange(value: Record<string, TriStateValue>): Promise<void> {
    this.statuses = value;
  }

  async handleTagsChange(value: Record<string, TriStateValue>): Promise<void> {
    this.tags = value;
  }

  async handleTagMatchModeChange(value: string[]): Promise<void> {
    this.tagMatchMode = [value[0] === "or" ? "or" : "and"];
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (Object.keys(this.types).length > 0) result.types = this.types;
    if (Object.keys(this.statuses).length > 0) result.statuses = this.statuses;
    if (Object.keys(this.tags).length > 0) {
      result.tags = this.tags;
      result.tagMatchMode = this.tagMatchMode[0] ?? "and";
    }
    return result;
  }
}
