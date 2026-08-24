/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Form,
  InputRow,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import {
  COMPLETION_OPTIONS,
  GENRES,
  MATCH_OPTIONS,
  RATING_MATCH_OPTIONS,
  RATING_OPTIONS,
  STATE_KEYS,
  TYPE_OPTIONS,
  YEAR_OPTIONS,
  type SearchMetadata,
  type TriState,
} from "./models";

// MangaHere serves its adult catalog to everyone, so the toggle starts on.
export const getShowAdultTitles = (): boolean =>
  (Application.getState(STATE_KEYS.SHOW_ADULT) as boolean | undefined) ?? true;

export class MangaHereSettingsForm extends Form {
  private showAdultTitles = getShowAdultTitles();

  override getSections() {
    return [
      Section(
        { id: "content", footer: "Turn this off to hide titles rated adult across the source." },
        [
          ToggleRow("show_adult", {
            title: "Show adult titles",
            value: this.showAdultTitles,
            onValueChange: Application.Selector(
              this as MangaHereSettingsForm,
              "handleShowAdultTitlesChange",
            ),
          }),
        ],
      ),
    ];
  }

  async handleShowAdultTitlesChange(value: boolean): Promise<void> {
    this.showAdultTitles = value;
    Application.setState(value, STATE_KEYS.SHOW_ADULT);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}

export class MangaHereAdvancedSearchForm extends AdvancedSearchForm {
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
  private completion: string[];

  constructor(query: SearchQuery<SearchMetadata>) {
    super();
    const metadata = query.metadata ?? {};
    this.type = metadata.type ?? ["0"];
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
    this.completion = metadata.completion ?? ["0"];
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
            this as MangaHereAdvancedSearchForm,
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
            this as MangaHereAdvancedSearchForm,
            "handleNameMatchChange",
          ),
        }),
      ]),
      Section("credits", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as MangaHereAdvancedSearchForm,
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
            this as MangaHereAdvancedSearchForm,
            "handleAuthorMatchChange",
          ),
        }),
        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector(
            this as MangaHereAdvancedSearchForm,
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
            this as MangaHereAdvancedSearchForm,
            "handleArtistMatchChange",
          ),
        }),
      ]),
      Section({ id: "genres", footer: "Tap once to include a genre, twice to exclude it." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: [...GENRES],
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as MangaHereAdvancedSearchForm,
            "handleGenresChange",
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
            this as MangaHereAdvancedSearchForm,
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
            this as MangaHereAdvancedSearchForm,
            "handleRatingChange",
          ),
        }),
      ]),
      Section("released", [
        InputRow("released", {
          title: "Year of release",
          value: this.released,
          onValueChange: Application.Selector(
            this as MangaHereAdvancedSearchForm,
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
            this as MangaHereAdvancedSearchForm,
            "handleReleasedMatchChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("completion", {
          title: "Completed series",
          layout: "flow",
          value: this.completion,
          items: COMPLETION_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaHereAdvancedSearchForm,
            "handleCompletionChange",
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

  async handleCompletionChange(value: string[]): Promise<void> {
    this.completion = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const metadata: SearchMetadata = {};
    if (this.type[0] && this.type[0] !== "0") metadata.type = this.type;
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
    if (this.rating[0] !== "") {
      metadata.rating = this.rating;
      metadata.ratingMatch = this.ratingMatch;
    }
    if (this.completion[0] && this.completion[0] !== "0") {
      metadata.completion = this.completion;
    }
    return metadata;
  }
}
