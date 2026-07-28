/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Form } from "@paperback/types";

import type { ChikariImplementation } from "../../main";
import { SECTION_OPTIONS, type SectionId } from "../discover-section-providing/models";
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
  return [...order, ...validIds.filter((id) => !order.includes(id))];
};

export const getVisibleSections = (): SectionId[] => {
  const validIds = SECTION_OPTIONS.map((section) => section.id);
  const stored = Application.getState(STATE_KEYS.VISIBLE_SECTIONS) as SectionId[] | undefined;
  const visible = stored?.filter((id) => validIds.includes(id)) ?? [];
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
