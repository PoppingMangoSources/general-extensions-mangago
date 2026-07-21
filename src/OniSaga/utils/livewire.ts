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

export const livewireHeaders = (referer: string): Record<string, string> => {
  return {
    "X-Livewire": "",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/json",
    Origin: DOMAIN,
    Referer: referer,
  };
};

export const buildSectionToggleRequest = (
  state: LivewireState,
  method: string,
  value: string,
): ToggleLivewireRequest => {
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
};

export const defaultUpdates = (): PostFilterUpdates => {
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
};

export const extractLivewireState = (
  $: CheerioAPI,
  componentName: string,
): LivewireState | undefined => {
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
};

const decodeEntities = (value: string): string => {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
};

export const extractLivewireStateFromHtml = (
  html: string,
  componentName: string,
): LivewireState | undefined => {
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
};

export const buildBrowseRequest = (
  state: LivewireState,
  updates: PostFilterUpdates,
  page: number,
): BrowseLivewireRequest => {
  const calls: LivewireCall[] = [
    { type: "call", path: "", method: "updateSort", params: [updates.sort || DEFAULT_SORT] },
    { type: "call", path: "", method: "updatePlatform", params: [updates.platform] },
    { type: "call", path: "", method: "gotoPage", params: [page] },
  ];

  return {
    _token: state.token,
    components: [{ snapshot: state.snapshot, updates, calls }],
  };
};

export const buildLoadMoreChaptersRequest = (state: LivewireState): ChapterLivewireRequest => {
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
};
