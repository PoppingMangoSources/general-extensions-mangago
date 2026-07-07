/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type CheerioAPI } from "cheerio";

import {
  DEFAULT_SORT,
  DOMAIN,
  type BrowseLivewireRequest,
  type ChapterLivewireRequest,
  type LivewireCall,
  type LivewireState,
  type PostFilterUpdates,
  type ToggleLivewireRequest,
} from "../models";

// Headers a Livewire `POST /livewire/update` expects (JSON body, XHR marker).
export function livewireHeaders(referer: string): Record<string, string> {
  return {
    "X-Livewire": "",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/json",
    Origin: DOMAIN,
    Referer: referer,
  };
}

// Invoke a single Livewire method (setPeriod / setSort / setPlatform) on a
// rail's component to switch its time range / platform and re-render its cards.
export function buildSectionToggleRequest(
  state: LivewireState,
  method: string,
  value: string,
): ToggleLivewireRequest {
  return {
    _token: state.token,
    components: [
      {
        snapshot: state.snapshot,
        updates: {},
        calls: [{ type: "call", path: "", method, params: [value] }],
      },
    ],
  };
}

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

// The snapshot lives in a `wire:snapshot` attribute; the CSRF token in a
// `<meta name="csrf-token">` (or `_token` input). Match the component by name.
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

// wire:snapshot values are HTML-entity-encoded JSON.
function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Same extraction straight off the raw document text. The /browse page can be
// well over 10 MB, which cheerio takes ages to parse on-device; two regexes
// over the string find the CSRF token and the component snapshot instantly.
export function extractLivewireStateFromHtml(
  html: string,
  componentName: string,
): LivewireState | undefined {
  const token =
    html.match(/<meta name="csrf-token" content="([^"]+)"/)?.[1] ??
    html.match(/name="_token"\s+value="([^"]+)"/)?.[1];
  if (!token) return undefined;

  const snapshotRegex = /wire:snapshot="([^"]+)"/g;
  for (const match of html.matchAll(snapshotRegex)) {
    if (match[1].includes(componentName)) {
      return { token, snapshot: decodeEntities(match[1]) };
    }
  }
  return undefined;
}

export function buildBrowseRequest(
  state: LivewireState,
  updates: PostFilterUpdates,
  page: number,
): BrowseLivewireRequest {
  // Sort and platform are switched through component methods on the site
  // (property writes alone don't re-sort). Always send them — a cached
  // snapshot may carry a previous request's sort/platform, so switching back
  // to the defaults must reset the component too, not just the properties.
  const calls: LivewireCall[] = [
    { type: "call", path: "", method: "updateSort", params: [updates.sort || DEFAULT_SORT] },
    { type: "call", path: "", method: "updatePlatform", params: [updates.platform] },
    { type: "call", path: "", method: "gotoPage", params: [page] },
  ];

  return {
    _token: state.token,
    components: [{ snapshot: state.snapshot, updates, calls }],
  };
}

// Pull the entire chapter (and volume) list in a single Livewire round-trip by
// setting the component's loaded-counts straight to a number larger than any
// series, instead of repeatedly calling loadMoreChapters.
export function buildLoadMoreChaptersRequest(state: LivewireState): ChapterLivewireRequest {
  return {
    _token: state.token,
    components: [
      {
        snapshot: state.snapshot,
        updates: { chaptersLoaded: 3000, volumesLoaded: 3000 },
        calls: [],
      },
    ],
  };
}
