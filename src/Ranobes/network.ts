/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
  type SortingOption,
} from "@paperback/types";

import { DOMAIN, SORT_ORDERS, type SearchMetadata } from "./models";

// Requests may arrive with IDs pointing at a mirror host; route them to the canonical domain.
export const canonicalUrl = (url: string): string =>
  url.replace(/^https?:\/\/(?:www\.)?ranobes\.[a-z.]+/i, DOMAIN);

export const toFilterOptionId = (title: string): string =>
  encodeURIComponent(title).replace(
    /[!'()*~]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const filterTitle = (id: string): string => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
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

export class RanobesInterceptor extends PaperbackInterceptor {
  private challengeThrownAt = 0;

  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
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
    const server = response.headers?.["server"] ?? "";
    const challenged =
      response.headers?.["cf-mitigated"] === "challenge" ||
      // DDoS-Guard (and the vBulletin gate) serve their interstitial as a 403.
      (response.status === 403 && /ddos-guard/i.test(server)) ||
      /(?:vb_challenge|cf-turnstile|ddos-guard|<title>\s*(?:Just a moment|DDoS-Guard))/i.test(body);
    if (!challenged) return data;

    // Chapter and discovery fan-out fire many requests at once; open a single
    // bypass per challenge episode instead of one per concurrent fetch.
    const now = Date.now();
    if (now - this.challengeThrownAt < 60_000) {
      throw new Error("Ranobes: bypass pending — complete the browser check and refresh.");
    }
    this.challengeThrownAt = now;
    throw new CloudflareError({
      url: request.url,
      method: request.method ?? "GET",
      headers: { "user-agent": await Application.getDefaultUserAgent() },
    });
  }
}

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
  });
  return responseText(response, buffer, url);
};

export const fetchListingPage = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterListPage = (novelId: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);
