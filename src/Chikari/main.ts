/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  type Cookie,
  type Extension,
  type MangaProviding,
  type Request,
  type Tag,
} from "@paperback/types";

import { ChapterProvider } from "./implementations/chapter-providing/main";
import { DiscoverProvider } from "./implementations/discover-section-providing/main";
import { MangaProvider } from "./implementations/manga-details-providing/main";
import { SearchProvider } from "./implementations/search-results-providing/main";
import { SettingsFormProvider } from "./implementations/settings-form-providing/main";
import { getPreferences } from "./implementations/settings-form-providing/main";
import type { HomeResponse } from "./implementations/shared/models";
import { toGenreOptions, toTagOptions } from "./implementations/shared/parsers";
import { applyMixins } from "./implementations/shared/utils";
import {
  ChikariInterceptor,
  fetchGenres,
  fetchHome,
  fetchNovelGenres,
  fetchNovelHome,
  fetchNovelTags,
  fetchTags,
} from "./services/network";

export interface ChikariImplementation
  extends SearchProvider, MangaProvider, ChapterProvider, DiscoverProvider, SettingsFormProvider {
  getGenreOptions(): Promise<Tag[]>;
  getHomeData(): Promise<HomeResponse>;
  getNovelHomeData(): Promise<HomeResponse>;
  getTagOptions(): Promise<Tag[]>;
}

class ChikariExtension implements Omit<Extension, keyof MangaProviding> {
  private rateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  private cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  private interceptor = new ChikariInterceptor("chikari-interceptor");
  private genresAdult?: boolean;
  private genresPromise?: Promise<Tag[]>;
  private homePromise?: Promise<HomeResponse>;
  private novelHomePromise?: Promise<HomeResponse>;
  private tagsAdult?: boolean;
  private tagsPromise?: Promise<Tag[]>;

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
      this.cookieStorageInterceptor.setCookie(cookie);
    }
    this.genresPromise = undefined;
    this.homePromise = undefined;
    this.novelHomePromise = undefined;
    this.tagsPromise = undefined;
  }

  async getHomeData(): Promise<HomeResponse> {
    const request = (this.homePromise ??= fetchHome(getPreferences()));
    try {
      return await request;
    } finally {
      if (this.homePromise === request) this.homePromise = undefined;
    }
  }

  async getNovelHomeData(): Promise<HomeResponse> {
    const request = (this.novelHomePromise ??= fetchNovelHome(getPreferences().adult));
    try {
      return await request;
    } finally {
      if (this.novelHomePromise === request) this.novelHomePromise = undefined;
    }
  }

  getGenreOptions(): Promise<Tag[]> {
    const adult = getPreferences().adult;
    if (adult !== this.genresAdult) {
      this.genresAdult = adult;
      this.genresPromise = undefined;
    }
    return (this.genresPromise ??= Promise.all([fetchGenres(adult), fetchNovelGenres(adult)]).then(
      (genres) => toGenreOptions(genres.flat()),
    ));
  }

  getTagOptions(): Promise<Tag[]> {
    const adult = getPreferences().adult;
    if (adult !== this.tagsAdult) {
      this.tagsAdult = adult;
      this.tagsPromise = undefined;
    }
    return (this.tagsPromise ??= Promise.all([fetchTags(adult), fetchNovelTags(adult)]).then(
      (tags) => toTagOptions(tags.flat()),
    ));
  }
}

applyMixins(ChikariExtension, [
  SearchProvider,
  MangaProvider,
  ChapterProvider,
  DiscoverProvider,
  SettingsFormProvider,
]);

export const Chikari = new ChikariExtension() as ChikariImplementation & ChikariExtension;
