/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  SelectSection,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  AI_OPTIONS,
  GENRE_MATCH_OPTIONS,
  GENRES,
  STATUS_OPTIONS,
  type SearchMetadata,
  type TriState,
} from "../models";
import { getDefaultAiMode, toTags } from "./settings";

export class NovelArchiveAdvancedSearchForm extends AdvancedSearchForm {
  private status: string[];
  private ai: string[];
  private genreMatch: string[];
  private genres: TriState;

  private readonly statusOptions: Tag[] = toTags(STATUS_OPTIONS);
  private readonly aiOptions: Tag[] = toTags(AI_OPTIONS);
  private readonly genreMatchOptions: Tag[] = toTags(GENRE_MATCH_OPTIONS);
  private readonly genreOptions: Tag[] = toTags(GENRES);

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.status = meta.status ?? [];
    this.ai = meta.ai ?? [getDefaultAiMode()];
    this.genreMatch = meta.genreMatch ?? ["all"];
    this.genres = { ...meta.genres };
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
            this as NovelArchiveAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),
      Section({ id: "ai", footer: "Filter novels written by AI." }, [
        SelectRow("ai", {
          title: "AI generated",
          layout: "flow",
          value: this.ai,
          items: this.aiOptions,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelArchiveAdvancedSearchForm,
            "handleAiChange",
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
            this as NovelArchiveAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      SelectSection(this, {
        id: "genre_match",
        layout: "flow",
        value: this.genreMatch,
        items: this.genreMatchOptions,
        minItemCount: 1,
        maxItemCount: 1,
      }),
    ];
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleAiChange(value: string[]): Promise<void> {
    this.ai = value;
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.status.length > 0) result.status = this.status;
    if (this.ai.length > 0) result.ai = this.ai;
    if (this.genreMatch.length > 0) result.genreMatch = this.genreMatch;
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    return result;
  }
}
