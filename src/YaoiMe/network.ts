/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import {
  CONTENT_RATING_OPTIONS,
  DOMAIN,
  SECTIONS,
  TYPE_OPTIONS,
  type Preferences,
  type SearchMetadata,
} from "./models";

const IMAGE_REGEX = /\.(?:avif|gif|jpe?g|jxl|png|svg|webp)(?:[/?#]|$)|\/i\/[cp]\//i;

export class YaoiMeInterceptor extends PaperbackInterceptor {
  constructor(
    id: string,
    private readonly preferences: () => Preferences,
    private readonly sectionOrder: () => string[],
  ) {
    super(id);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const preferences = this.preferences();
    const settings = encodeURIComponent(
      JSON.stringify({
        chapterLangs: preferences.chapterLanguages,
        hiddenRatings: CONTENT_RATING_OPTIONS.map(({ id }) => id).filter(
          (id) => !preferences.contentRatings.includes(id),
        ),
        hiddenTags: preferences.hiddenTags,
        hiddenTypes: TYPE_OPTIONS.map(({ id }) => id).filter(
          (id) => !preferences.contentTypes.includes(id),
        ),
        home: this.sectionOrder().filter((id) => id !== SECTIONS.GENRES),
        officialOnly: preferences.officialOnly,
      }),
    );
    const cookie = [`yf.adult=1`, `yf.settings=${settings}`, request.headers?.cookie]
      .filter(Boolean)
      .join("; ");
    return {
      ...request,
      headers: {
        ...request.headers,
        accept:
          request.headers?.accept ??
          (IMAGE_REGEX.test(request.url)
            ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
        "accept-language": "en-US,en;q=0.8",
        cookie,
        referer: request.headers?.referer ?? `${DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const contentType = response.headers?.["content-type"] ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      /(?:Just a moment|cf-chl-|_cf_chl_opt|siteKey.{0,16}0x4)/i.test(body)
    ) {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

const fetchText = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) throw new Error(`Content not found: ${url}`);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(await fetchText(url));

const values = (state: SearchMetadata["genres"], selected: "included" | "excluded"): string[] =>
  Object.entries(state ?? {})
    .filter(([, value]) => value === selected)
    .map(([id]) => id);

export const browseUrl = (
  page: number,
  query: string,
  metadata: SearchMetadata,
  sortingId: string,
): string => {
  const [sort = "update", dir = "desc"] = sortingId.split("-");
  const url = new URL(`${DOMAIN}/browse`)
    .setQueryItem("page", String(page))
    .setQueryItem("sort", sort)
    .setQueryItem("dir", dir);
  const entries: [string, string | string[] | undefined][] = [
    ["q", query.trim() || undefined],
    ["anime", metadata.anime ? "1" : undefined],
    ["lang", metadata.languages],
    ["genre", values(metadata.genres, "included")],
    ["without", values(metadata.genres, "excluded")],
    ["tags", values(metadata.tags, "included")],
    ["withoutTags", values(metadata.tags, "excluded")],
    ["author", metadata.author],
    ["artist", metadata.artist],
    ["publisher", metadata.publisher],
    ["type", metadata.types],
    ["status", metadata.statuses],
    ["content", metadata.ratings],
    ["demographic", metadata.demographics],
    ["yearFrom", metadata.yearFrom],
    ["yearTo", metadata.yearTo],
    ["minChapters", metadata.minChapters],
    ["maxChapters", metadata.maxChapters],
    ["minPages", metadata.minPages],
    ["minRating", metadata.minRating],
    ["maxRating", metadata.maxRating],
    ["updatedWithin", metadata.updatedWithin],
    ["licensed", metadata.licensed ? "1" : undefined],
  ];
  for (const [key, value] of entries) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    url.setQueryItem(key, Array.isArray(value) ? value.join(",") : value);
  }
  return url.toString();
};

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchDocument(`${DOMAIN}/`);

export const fetchBrowsePage = (
  page: number,
  query: string,
  metadata: SearchMetadata,
  sortingId: string,
): Promise<cheerio.CheerioAPI> => fetchDocument(browseUrl(page, query, metadata, sortingId));

export const fetchSeriesPage = (mangaId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(`${DOMAIN}${mangaId}`);

export const fetchChapterPage = (chapterId: string): Promise<string> =>
  fetchText(`${DOMAIN}${chapterId}`);
