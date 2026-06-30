/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type CheerioAPI } from "cheerio";

import {
  DEFAULT_SORT,
  type BrowseLivewireRequest,
  type ChapterLivewireRequest,
  type LivewireState,
  type PostFilterUpdates,
} from "./models";

export function defaultUpdates(): PostFilterUpdates {
  return {
    platform: "",
    status: "",
    sort: DEFAULT_SORT,
    min_chapters: "",
    group: null,
    release_start: null,
    release_end: null,
    genre: [],
    excludeGenre: [],
  };
}

export function isDefaultUpdates(updates: PostFilterUpdates): boolean {
  return (
    updates.platform === "" &&
    updates.status === "" &&
    updates.sort === DEFAULT_SORT &&
    updates.min_chapters === "" &&
    updates.group === null &&
    updates.release_start === null &&
    updates.release_end === null &&
    updates.genre.length === 0 &&
    updates.excludeGenre.length === 0
  );
}

// The Livewire snapshot lives in a `wire:snapshot` attribute on the component
// root; the CSRF token is a `<meta name="csrf-token">` (or an `_token` input).
// Match the component by name appearing inside the snapshot JSON, mirroring the
// reference implementation.
export function extractLivewireState(
  $: CheerioAPI,
  componentName: string,
): LivewireState | undefined {
  const token =
    $("meta[name=csrf-token]").attr("content")?.trim() ||
    $("input[name=_token]").attr("value")?.trim();
  if (!token) return undefined;

  let snapshot: string | undefined;
  $("[wire\\:snapshot]").each((_, el) => {
    if (snapshot) return;
    const value = $(el).attr("wire:snapshot");
    if (value && value.includes(componentName)) {
      snapshot = value;
    }
  });

  if (!snapshot) return undefined;
  return { token, snapshot };
}

export function buildBrowseRequest(
  state: LivewireState,
  updates: PostFilterUpdates,
  page: number,
): BrowseLivewireRequest {
  return {
    _token: state.token,
    components: [
      {
        snapshot: state.snapshot,
        updates,
        calls: [{ type: "call", path: "", method: "gotoPage", params: [page] }],
      },
    ],
  };
}

export function buildLoadMoreChaptersRequest(state: LivewireState): ChapterLivewireRequest {
  return {
    _token: state.token,
    components: [
      {
        snapshot: state.snapshot,
        updates: {},
        calls: [{ type: "call", path: "", method: "loadMoreChapters", params: [] }],
      },
    ],
  };
}
