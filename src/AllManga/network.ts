/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { API_URL, DOMAIN, type GraphQLResponse } from "./models";

const API_HOST = "api.allanime.day";

export class AllMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isApi = request.url.includes(API_HOST);
    const accept = isApi
      ? "application/json, text/plain, */*"
      : "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8";

    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
        accept,
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

function unwrap<T>(raw: string, url: string): T {
  let parsed: GraphQLResponse<T>;
  try {
    parsed = JSON.parse(raw) as GraphQLResponse<T>;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse GraphQL response from ${url}: ${reason}`);
  }

  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(`GraphQL error: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }
  if (!parsed.data) {
    throw new Error(`GraphQL response contained no data (${url})`);
  }
  return parsed.data;
}

async function run<T>(request: Request): Promise<T> {
  const [response, buffer] = await Application.scheduleRequest(request);
  if (response.status !== 200) {
    throw new Error(`Request failed with status ${response.status}: ${request.url}`);
  }
  return unwrap<T>(Application.arrayBufferToUTF8String(buffer), request.url);
}

// Listings/details/chapters are served over POST JSON.
export async function postGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  return run<T>({
    url: API_URL,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
}

// The `chapterPages` query is served over GET with the query + variables as
// URL params (this is the request shape that returns pages without a WebView).
export async function getGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const url = new URL(API_URL)
    .setQueryItem("query", query)
    .setQueryItem("variables", JSON.stringify(variables))
    .toString();
  return run<T>({ url, method: "GET" });
}
