/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Cookie,
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

const completeMobileSafariUserAgent = (userAgent: string): string => {
  if (!/\b(?:iPhone|iPad|iPod)\b/.test(userAgent) || /\bSafari\//.test(userAgent)) {
    return userAgent;
  }
  const os = /\bOS (\d+)[_.](\d+)/.exec(userAgent);
  const version = os ? `${os[1]}.${os[2]}` : "18.0";
  const withVersion = /\bVersion\//.test(userAgent)
    ? userAgent
    : userAgent.replace(/\sMobile\//, ` Version/${version} Mobile/`);
  return /\bSafari\//.test(withVersion) ? withVersion : `${withVersion} Safari/604.1`;
};

export const getRanobesUserAgent = async (): Promise<string> =>
  completeMobileSafariUserAgent(await Application.getDefaultUserAgent());

export const replaceSessionCookies = (cookies: Cookie[]): void => {
  cookieStorage.cookies = [];
  cookieStorage.setCookie({
    name: "browser_check",
    value: "1",
    domain: "ranobes.net",
    path: "/",
  });
  for (const cookie of cookies) {
    if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;
    cookieStorage.setCookie(cookie);
  }
};

const isChallengeResponse = (response: Response, body: string): boolean => {
  if (body.includes("window.__DATA__")) return false;
  if (response.headers?.["cf-mitigated"] === "challenge") return true;
  if (response.status === 403) return true;
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
        // DDoS-Guard fingerprints the request, so present a full browser-shaped
        // header set (not just UA + referer) to look like the challenge-solving
        // webview that earned the clearance cookie.
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9,ru;q=0.8",
        ...request.headers,
        referer: `${origin}/`,
        "user-agent": await getRanobesUserAgent(),
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
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          referer: `${DOMAIN}/`,
          "user-agent": await getRanobesUserAgent(),
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

// ranobe.top is intentionally not used. Its clearance is independent and
// repeatedly causes a second challenge cycle after ranobes.net succeeds.
export const fetchHtml = async (url: string): Promise<string> =>
  requestText(url.replace(MIRROR_HOST, DOMAIN));

export const fetchListingPage = (path: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}${path}${page > 1 ? `page/${page}/` : ""}`);

export const fetchChapterListPage = (novelId: string, page = 1): Promise<string> =>
  fetchHtml(`${DOMAIN}/chapters/${novelId}/${page > 1 ? `page/${page}/` : ""}`);
