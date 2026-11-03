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

import { getBaseUrl } from "./forms";
import { DOMAIN, MIRRORS, MIRROR_GENRES, STATE_KEYS, type SearchRequest } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;

const getUserAgent = async (): Promise<string> => {
  const agent = await Application.getDefaultUserAgent();
  if (!/\b(?:iPhone|iPad|iPod)\b/.test(agent) || /\bSafari\//.test(agent)) return agent;
  const os = /\bOS (\d+)[_.](\d+)/.exec(agent);
  const version = os ? `${os[1]}.${os[2]}` : "18.0";
  return `${/\bVersion\//.test(agent) ? agent : agent.replace(/\sMobile\//, ` Version/${version} Mobile/`)} Safari/604.1`;
};

export class BunMangaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    const origin = MIRRORS.find((mirror) => request.url.startsWith(`${mirror}/`)) ?? getBaseUrl();
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: request.headers?.referer ?? `${origin}/`,
        origin,
        "user-agent": await getUserAgent(),
        accept:
          request.headers?.accept ??
          (isImage
            ? "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8"
            : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"),
        "accept-language": "en-US,en;q=0.5",
      },
      cookies: {
        ...request.cookies,
        "wpmanga-adault": "1",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const headers = Object.fromEntries(
      Object.entries(response.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const contentType = headers["content-type"] ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      headers["cf-mitigated"] === "challenge" ||
      (response.status === 403 && /(?:Just a moment|cf-chl-|_cf_chl_opt|g-recaptcha)/i.test(body))
    ) {
      throw new CloudflareError({
        url: `${MIRRORS.find((mirror) => request.url.startsWith(`${mirror}/`)) ?? getBaseUrl()}/`,
        method: "GET",
        headers: { "user-agent": await getUserAgent() },
      });
    }
    return data;
  }
}

const fetchText = async (request: Request): Promise<string> => {
  const requestedOrigin = MIRRORS.find((mirror) => request.url.startsWith(`${mirror}/`));
  if (!requestedOrigin) throw new Error("Unsupported BunManga request host.");
  const origins = [...new Set([getBaseUrl(), requestedOrigin, ...MIRRORS])];
  let lastError: unknown;
  let challenge: CloudflareError | undefined;
  for (const origin of origins) {
    const url = new URL(request.url.replace(requestedOrigin, origin));
    const genreMap =
      origin === DOMAIN
        ? Object.fromEntries(Object.entries(MIRROR_GENRES).map(([bun, mirror]) => [mirror, bun]))
        : MIRROR_GENRES;
    const genres = url.queryItems?.["genre[]"];
    if (genres)
      url.setQueryItem(
        "genre[]",
        (Array.isArray(genres) ? genres : [genres]).map((genre) => genreMap[genre] ?? genre),
      );
    let result: Awaited<ReturnType<typeof Application.scheduleRequest>>;
    try {
      result = await Application.scheduleRequest({
        ...request,
        url: url.toString(),
        headers: {
          ...request.headers,
          ...(request.headers?.referer
            ? { referer: request.headers.referer.replace(requestedOrigin, origin) }
            : {}),
        },
      });
    } catch (error: unknown) {
      if (error instanceof CloudflareError) challenge ??= error;
      lastError = error;
      continue;
    }
    const [response, buffer] = result;
    const body = Application.arrayBufferToUTF8String(buffer);
    if (response.status === 403 && cheerio.load(body)(".mhcl-lock-box").length) {
      throw new Error(
        "This chapter is password protected on the website. Unlock it there before reading.",
      );
    }
    if (response.status === 200) {
      Application.setState(origin, STATE_KEYS.ACTIVE_BASE_URL);
      return body;
    }
    lastError = new Error(`Request failed with status ${response.status}: ${url.toString()}`);
    if (
      ![403, 404, 408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524].includes(response.status)
    )
      throw lastError;
  }
  throw challenge ?? lastError ?? new Error("BunManga and ManhuaHot are unavailable.");
};

const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(await fetchText({ url, method: "GET" }));

export const buildSearchUrl = (request: SearchRequest, page = 1): string => {
  const url = new URL(request.title ? `${getBaseUrl()}/` : `${getBaseUrl()}/?s`).setQueryItem(
    "post_type",
    "wp-manga",
  );
  if (page > 1) url.setPath(`/page/${page}/`);
  if (request.title) url.setQueryItem("s", request.title);
  if (request.sortBy && request.sortBy !== "relevance") {
    url.setQueryItem("m_orderby", request.sortBy);
  }
  if (request.genres?.length) url.setQueryItem("genre[]", request.genres);
  if (request.genreMatch === "and") url.setQueryItem("op", "1");
  if (request.author) url.setQueryItem("author", request.author);
  if (request.artist) url.setQueryItem("artist", request.artist);
  if (request.releaseYear) url.setQueryItem("release", request.releaseYear);
  if (request.adult && request.adult !== "all") url.setQueryItem("adult", request.adult);
  if (request.statuses?.length) url.setQueryItem("status[]", request.statuses);
  return url.toString();
};

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchDocument(`${getBaseUrl()}/`);

export const fetchSearchPage = (request: SearchRequest, page = 1): Promise<cheerio.CheerioAPI> =>
  fetchDocument(buildSearchUrl(request, page));

export const fetchMangaPage = (mangaId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(
    new URL(getBaseUrl())
      .addPathComponent("manga")
      .addPathComponent(mangaId)
      .addPathComponent("")
      .toString(),
  );

export const fetchChapterList = async (mangaId: string): Promise<cheerio.CheerioAPI> => {
  const url = new URL(getBaseUrl())
    .addPathComponent("manga")
    .addPathComponent(mangaId)
    .addPathComponent("ajax")
    .addPathComponent("chapters")
    .addPathComponent("")
    .toString();
  return cheerio.load(
    await fetchText({
      url,
      method: "POST",
      body: "",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        referer: `${getBaseUrl()}/manga/${mangaId}/`,
        "x-requested-with": "XMLHttpRequest",
      },
    }),
  );
};

export const fetchReaderPage = (mangaId: string, chapterId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(
    new URL(getBaseUrl())
      .addPathComponent("manga")
      .addPathComponent(mangaId)
      .addPathComponent(chapterId)
      .addPathComponent("")
      .setQueryItem("style", "list")
      .toString(),
  );
