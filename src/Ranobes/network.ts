/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Response, SortingOption } from "@paperback/types";

import { DOMAIN, SORT_ORDERS, type RanobesChapterPage, type SearchMetadata } from "./models";

export const toFilterOptionId = (title: string): string =>
  `filter_${Array.from(title)
    .map((character) => character.codePointAt(0)?.toString(36))
    .join("_")}`;

const filterTitle = (id: string): string => {
  if (!id.startsWith("filter_")) return id;
  const codePoints = id
    .slice(7)
    .split("_")
    .map((value) => Number.parseInt(value, 36));
  return codePoints.every(Number.isFinite) ? String.fromCodePoint(...codePoints) : id;
};

export const buildSearchPath = (
  title: string,
  metadata: SearchMetadata | undefined,
  sortingOption: SortingOption | undefined,
): string | undefined => {
  const segments: string[] = [];
  const add = (key: string, value?: string) => {
    if (value) segments.push(`${key}=${encodeURIComponent(value).replace(/%20/g, "+")}`);
  };
  const selected = (
    values: Record<string, "included" | "excluded"> | undefined,
    state: "included" | "excluded",
  ) =>
    Object.entries(values ?? {})
      .filter(([, value]) => value === state)
      .map(([id]) => filterTitle(id))
      .join(",");

  add("l.title", title.trim());
  add("n.genre", selected(metadata?.genres, "included"));
  add("v.genre", selected(metadata?.genres, "excluded"));
  add("n.events", selected(metadata?.events, "included"));
  add("v.events", selected(metadata?.events, "excluded"));
  add("b.languages", selected(metadata?.languages, "included"));
  add("v.languages", selected(metadata?.languages, "excluded"));
  add("f.year", metadata?.yearFrom);
  add("t.year", metadata?.yearTo);
  add("status-trs", metadata?.translationStatus);
  add("status-end", metadata?.originalStatus);
  add("f.chap-num", metadata?.chaptersFrom);
  add("t.chap-num", metadata?.chaptersTo);
  add("f.pvotenum", metadata?.ratingsFrom);
  add("t.pvotenum", metadata?.ratingsTo);
  add("n.authors", metadata?.authors);
  add("v.authors", metadata?.excludedAuthors);
  add("n.translater", metadata?.translators);
  add("v.translater", metadata?.excludedTranslators);
  add("n.l.tags", metadata?.publishers);
  add("!m.tags", metadata?.excludedPublishers);
  if (metadata?.onlyTranslated) add("g.translater", "1");
  if (metadata?.mtlFiles || metadata?.mtlReader) add("g.mtl_files", "1");
  if (metadata?.aiTranslated) {
    add("b.mtl-ai-translator", "DeepSeek,LLaMA 4,Gemini Flash,Mistral");
  }

  const sorting = SORT_ORDERS.find(({ id }) => id === sortingOption?.id);
  add("sort", sorting && "sort" in sorting ? sorting.sort : undefined);
  add("order", sorting && "order" in sorting ? sorting.order : undefined);
  return segments.length ? `/f/${segments.join("/")}/` : undefined;
};

const requestHeaders = async (): Promise<Record<string, string>> => ({
  referer: `${DOMAIN}/`,
  "user-agent": await Application.getDefaultUserAgent(),
});

const responseText = (response: Response, buffer: ArrayBuffer, url: string): string => {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ranobes request failed with status ${response.status}: ${url}`);
  }
  const text = Application.arrayBufferToUTF8String(buffer);
  if (!text.trim()) throw new Error(`Ranobes returned an empty response: ${url}`);
  return text;
};

export const fetchHtml = async (url: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: await requestHeaders(),
  });
  return responseText(response, buffer, url);
};

export const fetchListingPage = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterListPage = (novelId: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterSearch = async (novelId: string): Promise<RanobesChapterPage> => {
  const url = `${DOMAIN}/engine/mods/reader/ajax.php`;
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "POST",
    headers: {
      ...(await requestHeaders()),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: `search=Chapter&book_id=${encodeURIComponent(novelId)}`,
  });
  const text = responseText(response, buffer, url);
  try {
    return JSON.parse(text) as RanobesChapterPage;
  } catch {
    throw new Error(`Ranobes returned malformed chapter search data for ${novelId}`);
  }
};
