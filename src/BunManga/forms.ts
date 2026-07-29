/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  SelectSection,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  ADULT_OPTIONS,
  GENRE_MATCH_OPTIONS,
  STATUS_OPTIONS,
  type SearchMetadata,
  type TriState,
} from "./models";

export class BunMangaAdvancedSearchForm extends AdvancedSearchForm {
  private genres: TriState;
  private genreMatch: string[];
  private author: string;
  private artist: string;
  private releaseYear: string;
  private adult: string[];
  private statuses: string[];
  private readonly genreOptions: Tag[];

  constructor(query: SearchQuery<SearchMetadata>, genreOptions: Tag[]) {
    super();
    const metadata = query.metadata ?? {};
    this.genres = { ...metadata.genres };
    this.genreMatch = metadata.genreMatch ?? ["or"];
    this.author = metadata.author ?? "";
    this.artist = metadata.artist ?? "";
    this.releaseYear = metadata.releaseYear ?? "";
    this.adult = metadata.adult ?? ["all"];
    this.statuses = metadata.statuses ?? [];
    this.genreOptions = genreOptions;
  }

  override getSections() {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: false,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as BunMangaAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      SelectSection(this, {
        id: "genre_match",
        header: "Genre match",
        layout: "flow",
        value: this.genreMatch,
        items: GENRE_MATCH_OPTIONS,
        minItemCount: 1,
        maxItemCount: 1,
      }),
      Section("credits", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as BunMangaAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector(
            this as BunMangaAdvancedSearchForm,
            "handleArtistChange",
          ),
        }),
        InputRow("release_year", {
          title: "Release Year",
          value: this.releaseYear,
          onValueChange: Application.Selector(
            this as BunMangaAdvancedSearchForm,
            "handleReleaseYearChange",
          ),
        }),
      ]),
      Section("adult", [
        SelectRow("adult", {
          title: "Adult Content",
          layout: "flow",
          value: this.adult,
          items: ADULT_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as BunMangaAdvancedSearchForm,
            "handleAdultChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          layout: "flow",
          value: this.statuses,
          items: STATUS_OPTIONS,
          minItemCount: 0,
          maxItemCount: STATUS_OPTIONS.length,
          onValueChange: Application.Selector(
            this as BunMangaAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleArtistChange(value: string): Promise<void> {
    this.artist = value;
  }

  async handleReleaseYearChange(value: string): Promise<void> {
    this.releaseYear = value;
  }

  async handleAdultChange(value: string[]): Promise<void> {
    this.adult = value;
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (this.genreMatch[0] === "and") metadata.genreMatch = this.genreMatch;
    if (this.author.trim()) metadata.author = this.author.trim();
    if (this.artist.trim()) metadata.artist = this.artist.trim();
    if (this.releaseYear.trim()) metadata.releaseYear = this.releaseYear.trim();
    if (this.adult[0] && this.adult[0] !== "all") metadata.adult = this.adult;
    if (this.statuses.length > 0) metadata.statuses = this.statuses;
    return metadata;
  }
}
