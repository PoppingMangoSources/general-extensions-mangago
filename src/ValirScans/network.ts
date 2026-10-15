/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { getBaseUrl } from "./forms/settings";
import {
  TYPE_OPTIONS,
  STATUS_OPTIONS,
  ORIGIN_OPTIONS,
  type SearchMetadata,
  type TriState,
  type ValirAccountStatus,
} from "./models";

// Discover loads several sections at once, so a challenge would otherwise
// raise one bypass prompt per in-flight request. Only the first challenge in
// this window surfaces a prompt; the rest fail with a plain error.
const CHALLENGE_PROMPT_INTERVAL = 60_000;

export class ValirScansInterceptor extends PaperbackInterceptor {
  private lastChallengeAt = 0;

  resetChallengeState(): void {
    this.lastChallengeAt = 0;
  }

  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${getBaseUrl()}/`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      const now = Date.now();
      if (now - this.lastChallengeAt < CHALLENGE_PROMPT_INTERVAL) {
        throw new Error("Cloudflare challenge pending. Solve the open prompt, then reload.");
      }
      this.lastChallengeAt = now;
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

const fetchPage = async (url: string, rsc = false): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: rsc ? { rsc: "1" } : undefined,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

export const fetchHomePage = (): Promise<string> => fetchPage(`${getBaseUrl()}/`);

export const fetchAccountStatus = async (): Promise<ValirAccountStatus> => {
  const url = `${getBaseUrl()}/api/auth/session`;
  const body = await fetchPage(url);
  let value: unknown;
  try {
    value = JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error("ValirScans returned an invalid account response", { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { authenticated: false };
  }
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    return { authenticated: false };
  }
  const { id, name, email } = user as Record<string, unknown>;
  const displayName = typeof name === "string" && name.trim() ? name.trim() : undefined;
  const accountEmail = typeof email === "string" && email.trim() ? email.trim() : undefined;
  const authenticated =
    (typeof id === "string" && id.trim().length > 0) ||
    (typeof id === "number" && Number.isFinite(id)) ||
    Boolean(displayName || accountEmail);
  return authenticated
    ? { authenticated, displayName, email: accountEmail }
    : { authenticated: false };
};

const pickState = (record: TriState | undefined, state: "included" | "excluded"): string[] =>
  Object.keys(record ?? {}).filter((id) => record?.[id] === state);

export const fetchBrowsePage = (
  page: number,
  query?: string,
  sort?: string,
  filters?: SearchMetadata,
): Promise<string> => {
  const url = new URL(`${getBaseUrl()}/api/series`)
    .setQueryItem("page", page.toString())
    .setQueryItem("limit", "24")
    .setQueryItem("mode", "all");
  if (query?.trim()) url.setQueryItem("q", query.trim());
  if (sort) url.setQueryItem("sort", sort).setQueryItem("order", "desc");
  for (const [name, record] of [
    ["genre", filters?.genres],
    ["tag", filters?.tags],
  ] as const) {
    const included = pickState(record, "included"),
      excluded = pickState(record, "excluded");
    if (included.length) url.setQueryItem(name, included.join(","));
    if (excluded.length) url.setQueryItem(`ex${name}`, excluded.join(","));
  }
  for (const [name, record, options] of [
    ["type", filters?.types, TYPE_OPTIONS],
    ["status", filters?.statuses, STATUS_OPTIONS],
    ["origin", filters?.origins, ORIGIN_OPTIONS],
  ] as const) {
    const included = pickState(record, "included"),
      excluded = pickState(record, "excluded");
    if (!included.length && !excluded.length) continue;
    const selected = (included.length ? included : options.map((option) => option.id)).filter(
      (id) => !excluded.includes(id),
    );
    if (!selected.length) return Promise.resolve('{"data":[],"meta":{"hasMore":false}}');
    url.setQueryItem(name, selected.join(","));
  }
  const preset = /^(\d+)(?:-(\d+)|(\+))$/.exec(filters?.chapterPreset ?? "");
  const custom = !!(filters?.minChapters || filters?.maxChapters);
  const min = custom ? filters?.minChapters : preset?.[1];
  const max = custom ? filters?.maxChapters : preset?.[2];
  if (min) url.setQueryItem("ch_min", min);
  if (max) url.setQueryItem("ch_max", max);
  return fetchPage(url.toString());
};

export const fetchFacets = (): Promise<string> => fetchPage(`${getBaseUrl()}/api/series/facets`);

export const fetchSeriesPage = (mangaId: string, page = 1): Promise<string> =>
  fetchPage(`${getBaseUrl()}/series/${mangaId}${page > 1 ? `?page=${page}` : ""}`);

// The reader route serves its data as a Next.js RSC flight stream; the `rsc`
// header returns that stream directly instead of the full HTML shell.
export const fetchChapterPage = (mangaId: string, chapterId: string): Promise<string> =>
  fetchPage(`${getBaseUrl()}/series/${mangaId}/chapter/${chapterId}`, true);
