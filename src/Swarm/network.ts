/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import {
  DOMAIN,
  PAGE_SIZE,
  type ComicPage,
  type MangaListResponse,
  type SearchMetadata,
  type PagesResponse,
  type Preferences,
} from "./models";
import { parseComicPage } from "./parsers";
import { encryptPayload } from "./utils";
export class SwarmInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: request.headers?.referer ?? `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }
  override async interceptResponse(
    _request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge")
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    return data;
  }
}
export const fetchJSON = async <T>(url: string): Promise<T> => {
  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status !== 200)
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as T;
};
export const fetchComicPage = async (slug: string): Promise<ComicPage> => {
  const url = new URL(DOMAIN)
    .setPath(`comic/${decodeURIComponent(slug)}`)
    .setQueryItem("_rsc", "")
    .toString();
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: { rsc: "1", accept: "text/x-component" },
  });
  if (response.status !== 200)
    throw new Error(`Swarm returned status ${response.status} for this title.`);
  return parseComicPage(Application.arrayBufferToUTF8String(buffer));
};
export const buildSearchUrl = (
  term: string,
  page: number,
  sort: string,
  metadata: SearchMetadata,
  preferences: Preferences,
): string => {
  const url = new URL(DOMAIN)
    .setPath(term ? "api/comic/search" : "api/manga/filtered")
    .setQueryItem("limit", String(PAGE_SIZE))
    .setQueryItem("offset", String((page - 1) * PAGE_SIZE))
    .setQueryItem("order", sort);
  if (term) url.setQueryItem("title", term);
  if (metadata.genres?.length)
    url.setQueryItem("genres", metadata.genres.map(decodeURIComponent).join(","));
  if (metadata.tags?.length)
    url.setQueryItem("tags", metadata.tags.map(decodeURIComponent).join(","));
  if (metadata.types?.length)
    url.setQueryItem(
      "types",
      [
        ...new Set(
          metadata.types.flatMap((type) => [
            decodeURIComponent(type),
            decodeURIComponent(type).toLowerCase(),
          ]),
        ),
      ].join(","),
    );
  const mode = metadata.content?.[0] ?? preferences.content;
  if (mode === "safe") url.setQueryItem("nsfw", "false").setQueryItem("suggestive", "false");
  else if (mode === "adult") url.setQueryItem("nsfw", "true");
  for (const field of [
    "yearStartMin",
    "yearStartMax",
    "yearEndedMin",
    "yearEndedMax",
    "minChapters",
  ] as const) {
    const value = metadata[field]?.trim();
    if (value) {
      if (!/^\d+$/.test(value))
        throw new Error("Years and minimum chapters must be whole numbers.");
      url.setQueryItem(field, value);
    }
  }
  return url.toString();
};
export const fetchLatest = (
  page: number,
  filter: string,
  preferences: Preferences,
): Promise<MangaListResponse> => {
  const url = new URL(DOMAIN)
    .setPath("api/latest")
    .setQueryItem("limit", String(PAGE_SIZE))
    .setQueryItem("filter", filter)
    .setQueryItem("page", String(page))
    .setQueryItem("nsfw", String(preferences.content !== "safe"))
    .setQueryItem("suggestive", String(preferences.content !== "safe"));
  if (preferences.content === "adult") url.setQueryItem("nsfwOnly", "true");
  return fetchJSON<MangaListResponse>(url.toString());
};
export const fetchChapterPages = async (chapterId: string): Promise<PagesResponse> => {
  const payload = await encryptPayload(
    JSON.stringify({ chapterId, nocache: false, clean: false, force: false }),
  );
  const [response, buffer] = await Application.scheduleRequest({
    url: `${DOMAIN}/api/sp`,
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ payload }),
  });
  if (response.status !== 200)
    throw new Error(`Swarm's reader returned status ${response.status}.`);
  return JSON.parse(Application.arrayBufferToUTF8String(buffer)) as PagesResponse;
};
