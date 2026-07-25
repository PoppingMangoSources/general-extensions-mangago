/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Request,
  type Response,
  type SortingOption,
} from "@paperback/types";

import { DOMAIN, SORT_ORDERS, type SearchMetadata, type TriState } from "./models";

const MIRROR_HOST = /^https?:\/\/(?:www\.)?ranobes\.[a-z.]+/i;

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
  const selected = (values: TriState | undefined, state: "included" | "excluded") =>
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

export const cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

const ROTATING_CLEARANCE = ["__ddg8_", "__ddg9_", "__ddg10_"];

export const dropRotatingClearance = (): void => {
  const stale = cookieStorage.cookies.filter((cookie) => ROTATING_CLEARANCE.includes(cookie.name));
  for (const cookie of stale) cookieStorage.deleteCookie(cookie);
};

const isChallengeResponse = (response: Response, body: string): boolean => {
  const status = response.status;
  if (response.headers?.["cf-mitigated"] === "challenge") return true;
  if ([403, 429, 503].includes(status)) return true;
  return /(?:vb_challenge|cf-turnstile|<title>Just a moment|ddos-guard|checking your browser|enable javascript and cookies|__ddg\d+_)/i.test(
    body,
  );
};

export class RanobesInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const origin = request.url.match(MIRROR_HOST)?.[0] ?? DOMAIN;
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${origin}/`,
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
    if (isChallengeResponse(response, body)) {
      dropRotatingClearance();
      // Bounce every challenge to the site root so concurrent discover fetches
      // (ranking, updates, …) collapse into a single bypass prompt whose
      // clearance then covers the whole domain.
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: {
          referer: `${DOMAIN}/`,
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
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

// Identical concurrent GETs (e.g. discover and a chapter list hitting the same
// page) share one in-flight promise so we never fire duplicate network requests.
const inFlightTextRequests = new Map<string, Promise<string>>();

const requestText = async (url: string): Promise<string> => {
  const key = `GET:${url}`;
  const existing = inFlightTextRequests.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return responseText(response, buffer, url);
  })();
  inFlightTextRequests.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlightTextRequests.get(key) === promise) {
      inFlightTextRequests.delete(key);
    }
  }
};

// Keep chapter-list crawling gentle. Very long novels require many sequential
// pages, and ddos-guard starts challenging when those pages arrive too quickly.
let nextChapterListRequestAt = 0;
const waitForChapterListSlot = async (): Promise<void> => {
  const now = Date.now();
  const wait = Math.max(0, nextChapterListRequestAt - now);
  nextChapterListRequestAt = Math.max(now, nextChapterListRequestAt) + 1100;
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
};

// ranobe.top is intentionally not used. Its clearance is independent and
// repeatedly causes a second challenge cycle after ranobes.net succeeds.
export const fetchHtml = async (url: string): Promise<string> =>
  requestText(url.replace(MIRROR_HOST, DOMAIN));

export const fetchListingPage = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterListPage = async (novelId: string, page = 1): Promise<string> => {
  await waitForChapterListSlot();
  return fetchHtml(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);
};
