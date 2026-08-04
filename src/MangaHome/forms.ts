/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import {
  COMPLETED_OPTIONS,
  GENRES,
  MATCH_OPTIONS,
  RATING_MATCH_OPTIONS,
  RATING_OPTIONS,
  TYPE_OPTIONS,
  YEAR_OPTIONS,
  type SearchMetadata,
  type TriState,
} from "./models";

export class MangaHomeAdvancedSearchForm extends AdvancedSearchForm {
  private type: string[];
  private nameMatch: string[];
  private author: string;
  private authorMatch: string[];
  private artist: string;
  private artistMatch: string[];
  private genres: TriState;
  private released: string;
  private releasedMatch: string[];
  private rating: string[];
  private ratingMatch: string[];
  private completed: string[];

  constructor(query: SearchQuery<SearchMetadata>) {
    super();
    const metadata = query.metadata ?? {};
    this.type = metadata.type ?? [""];
    this.nameMatch = metadata.nameMatch ?? ["cw"];
    this.author = metadata.author ?? "";
    this.authorMatch = metadata.authorMatch ?? ["cw"];
    this.artist = metadata.artist ?? "";
    this.artistMatch = metadata.artistMatch ?? ["cw"];
    this.genres = { ...metadata.genres };
    this.released = metadata.released ?? "";
    this.releasedMatch = metadata.releasedMatch ?? ["eq"];
    this.rating = metadata.rating ?? [""];
    this.ratingMatch = metadata.ratingMatch ?? ["eq"];
    this.completed = metadata.completed ?? [""];
  }

  override getSections() {
    return [
      Section("type", [
        SelectRow("type", {
          title: "Type",
          layout: "flow",
          value: this.type,
          items: TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),
      ]),
      Section({ id: "title", footer: "How the series name is matched." }, [
        SelectRow("name_match", {
          title: "Series name",
          layout: "flow",
          value: this.nameMatch,
          items: MATCH_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleNameMatchChange",
          ),
        }),
      ]),
      Section("credits", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),
        SelectRow("author_match", {
          title: "Author match",
          layout: "flow",
          value: this.authorMatch,
          items: MATCH_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleAuthorMatchChange",
          ),
        }),
        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleArtistChange",
          ),
        }),
        SelectRow("artist_match", {
          title: "Artist match",
          layout: "flow",
          value: this.artistMatch,
          items: MATCH_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleArtistMatchChange",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include a genre, twice to exclude it." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: GENRES,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section("released", [
        InputRow("released", {
          title: "Year of release",
          value: this.released,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleReleasedChange",
          ),
        }),
        SelectRow("released_match", {
          title: "Released",
          layout: "flow",
          value: this.releasedMatch,
          items: YEAR_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleReleasedMatchChange",
          ),
        }),
      ]),
      Section("rating", [
        SelectRow("rating_match", {
          title: "Rating",
          layout: "flow",
          value: this.ratingMatch,
          items: RATING_MATCH_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleRatingMatchChange",
          ),
        }),
        SelectRow("rating", {
          title: "Stars",
          layout: "flow",
          value: this.rating,
          items: RATING_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleRatingChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("completed", {
          title: "Completed series",
          layout: "flow",
          value: this.completed,
          items: COMPLETED_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHomeAdvancedSearchForm,
            "handleCompletedChange",
          ),
        }),
      ]),
    ];
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value;
  }

  async handleNameMatchChange(value: string[]): Promise<void> {
    this.nameMatch = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleAuthorMatchChange(value: string[]): Promise<void> {
    this.authorMatch = value;
  }

  async handleArtistChange(value: string): Promise<void> {
    this.artist = value;
  }

  async handleArtistMatchChange(value: string[]): Promise<void> {
    this.artistMatch = value;
  }

  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
  }

  async handleReleasedChange(value: string): Promise<void> {
    this.released = value;
  }

  async handleReleasedMatchChange(value: string[]): Promise<void> {
    this.releasedMatch = value;
  }

  async handleRatingChange(value: string[]): Promise<void> {
    this.rating = value;
  }

  async handleRatingMatchChange(value: string[]): Promise<void> {
    this.ratingMatch = value;
  }

  async handleCompletedChange(value: string[]): Promise<void> {
    this.completed = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (this.type[0]) metadata.type = this.type;
    if (this.nameMatch[0] && this.nameMatch[0] !== "cw") metadata.nameMatch = this.nameMatch;
    if (this.author.trim()) {
      metadata.author = this.author.trim();
      metadata.authorMatch = this.authorMatch;
    }
    if (this.artist.trim()) {
      metadata.artist = this.artist.trim();
      metadata.artistMatch = this.artistMatch;
    }
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (this.released.trim()) {
      metadata.released = this.released.trim();
      metadata.releasedMatch = this.releasedMatch;
    }
    if (this.rating[0]) {
      metadata.rating = this.rating;
      metadata.ratingMatch = this.ratingMatch;
    }
    if (this.completed[0]) metadata.completed = this.completed;
    return metadata;
  }
}
