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

import { DOMAIN, MIRRORS, SORT_ORDERS, type SearchMetadata } from "./models";

const MIRROR_HOST = /^https?:\/\/(?:www\.)?ranobes\.[a-z.]+/i;

// Reuse whichever mirror last answered so a working host isn't re-probed.
let activeMirror = MIRRORS[0];

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

export const cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

// The protection signs a short-lived cookie pair and stalls any client that
// replays a stale one; a stalled request never receives the refreshed pair,
// so dropping it is the only way back to a clean state.
const ROTATING_CLEARANCE = ["__ddg8_", "__ddg10_"];

export const dropRotatingClearance = (): void => {
  const stale = cookieStorage.cookies.filter((cookie) => ROTATING_CLEARANCE.includes(cookie.name));
  for (const cookie of stale) cookieStorage.deleteCookie(cookie);
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
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      /(?:vb_challenge|cf-turnstile|<title>Just a moment)/i.test(body)
    ) {
      dropRotatingClearance();
      // Solving on the site root clears the domain-wide clearance, and the
      // root is a page the bypass webview can always render the challenge on.
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
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

const requestText = async (url: string): Promise<string> => {
  try {
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return responseText(response, buffer, url);
  } catch (error: unknown) {
    if (error instanceof CloudflareError) throw error;
    // A request that dies without a response usually replayed a stale
    // clearance pair; retry once as a clean client so it can be re-issued.
    dropRotatingClearance();
    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    return responseText(response, buffer, url);
  }
};

// A block on one mirror fails over to the next; the Cloudflare bypass only
// surfaces once every mirror is challenged, so a single blocked host is
// transparent to the reader.
export const fetchHtml = async (url: string): Promise<string> => {
  const ordered = [activeMirror, ...MIRRORS.filter((mirror) => mirror !== activeMirror)];
  let challenge: CloudflareError | undefined;
  let lastError: unknown;
  for (const mirror of ordered) {
    try {
      const text = await requestText(url.replace(MIRROR_HOST, mirror));
      activeMirror = mirror;
      return text;
    } catch (error: unknown) {
      if (error instanceof CloudflareError) challenge = error;
      lastError = error;
    }
  }
  if (challenge) throw challenge;
  throw lastError ?? new Error(`Ranobes: all mirrors failed for ${url}`);
};

export const fetchListingPage = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterListPage = (novelId: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);
