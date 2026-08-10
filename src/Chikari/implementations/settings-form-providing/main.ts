/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Form } from "@paperback/types";

import type { ChikariImplementation } from "../../main";
import {
  NOVEL_SECTION_IDS,
  SECTIONS,
  SECTION_OPTIONS,
  SECTION_SCHEMA_VERSION,
  type SectionId,
} from "../discover-section-providing/models";
import {
  DEFAULT_CONTENT_RATINGS,
  DEFAULT_CONTENT_TYPES,
  STATE_KEYS,
  type ChikariPreferences,
  type ContentPreferenceRating,
  type SeriesType,
} from "../shared/models";
import { ChikariSettingsForm } from "./forms";
import { CONTENT_RATING_OPTIONS, CONTENT_TYPE_OPTIONS } from "./models";

export const getPreferences = (): ChikariPreferences => {
  const validRatings = new Set(CONTENT_RATING_OPTIONS.map((option) => option.id));
  const storedRatings =
    (Application.getState(STATE_KEYS.CONTENT_RATINGS) as ContentPreferenceRating[] | undefined) ??
    [];
  const selectedRatings = storedRatings.filter((rating) => validRatings.has(rating));
  const contentRatings = selectedRatings.length > 0 ? selectedRatings : DEFAULT_CONTENT_RATINGS;
  const validTypes = new Set(CONTENT_TYPE_OPTIONS.map((option) => option.id));
  const storedTypes =
    (Application.getState(STATE_KEYS.CONTENT_TYPES) as SeriesType[] | undefined) ?? [];
  const selectedTypes = storedTypes.filter((type) => validTypes.has(type));
  return {
    adult: contentRatings.some((rating) => rating === "erotica" || rating === "pornographic"),
    contentRatings,
    excludedGenres:
      (Application.getState(STATE_KEYS.EXCLUDED_GENRES) as string[] | undefined) ?? [],
    excludedTags: (Application.getState(STATE_KEYS.EXCLUDED_TAGS) as string[] | undefined) ?? [],
    types: selectedTypes.length > 0 ? selectedTypes : DEFAULT_CONTENT_TYPES,
  };
};

export const getSectionOrder = (): SectionId[] => {
  const validIds = SECTION_OPTIONS.map((section) => section.id);
  const stored = (Application.getState(STATE_KEYS.SECTION_ORDER) as SectionId[] | undefined) ?? [];
  const order = [...new Set(stored.filter((id) => validIds.includes(id)))];
  const insertions: Array<{ after: SectionId; id: SectionId }> = [
    { after: SECTIONS.TRENDING, id: SECTIONS.TRENDING_NOVELS },
    { after: SECTIONS.RECENTLY_UPDATED, id: SECTIONS.RECENTLY_UPDATED_NOVELS },
    { after: SECTIONS.MOST_BOOKMARKED, id: SECTIONS.MOST_BOOKMARKED_NOVELS },
  ];
  for (const insertion of insertions) {
    if (order.includes(insertion.id)) continue;
    const index = order.indexOf(insertion.after);
    if (index >= 0) order.splice(index + 1, 0, insertion.id);
  }
  return [...order, ...validIds.filter((id) => !order.includes(id))];
};

export const getVisibleSections = (): SectionId[] => {
  const validIds = SECTION_OPTIONS.map((section) => section.id);
  const stored = Application.getState(STATE_KEYS.VISIBLE_SECTIONS) as SectionId[] | undefined;
  const visible = stored?.filter((id) => validIds.includes(id)) ?? [];
  const schemaVersion =
    (Application.getState(STATE_KEYS.SECTIONS_VERSION) as number | undefined) ?? 1;
  if (stored && schemaVersion < SECTION_SCHEMA_VERSION) {
    for (const id of NOVEL_SECTION_IDS) {
      if (!visible.includes(id)) visible.push(id);
    }
    Application.setState(visible, STATE_KEYS.VISIBLE_SECTIONS);
    Application.setState(SECTION_SCHEMA_VERSION, STATE_KEYS.SECTIONS_VERSION);
  }
  return visible.length > 0 ? visible : validIds;
};

export class SettingsFormProvider {
  async getSettingsForm(this: ChikariImplementation): Promise<Form> {
    const [genres, tags] = await Promise.all([this.getGenreOptions(), this.getTagOptions()]);
    return new ChikariSettingsForm(
      genres,
      tags,
      getPreferences(),
      getSectionOrder(),
      getVisibleSections(),
    );
  }
}
