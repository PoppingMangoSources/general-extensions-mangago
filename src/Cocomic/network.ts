import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { DOMAIN, type SearchRequest } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(avif|gif|jpe?g|jxl|png|svg|webp)(\/|\?|#|$)/i;

export class CocomicInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: request.headers?.referer ?? `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": await Application.getDefaultUserAgent(),
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
    const contentType = response.headers?.["content-type"] ?? "";
    const body = contentType.includes("text/html") ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 && /(?:Just a moment|cf-chl-|_cf_chl_opt|g-recaptcha)/i.test(body))
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

const postText = async (url: string, referer: string): Promise<string> => {
  const [response, buffer] = await Application.scheduleRequest({
    url,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      referer,
      "x-requested-with": "XMLHttpRequest",
    },
    body: "",
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }
  return Application.arrayBufferToUTF8String(buffer);
};

const fetchDocument = async (url: string): Promise<cheerio.CheerioAPI> =>
  cheerio.load(await fetchText(url));

export const buildBrowseUrl = (page: number, sortBy: string): string => {
  const url = new URL(page > 1 ? `${DOMAIN}/manga/page/${page}/` : `${DOMAIN}/manga/`);
  if (sortBy !== "relevance") url.setQueryItem("m_orderby", sortBy);
  return url.toString();
};

export const buildSearchUrl = (page: number, request: SearchRequest): string => {
  const url = new URL(page > 1 ? `${DOMAIN}/page/${page}/` : `${DOMAIN}/`)
    .setQueryItem("s", request.title ?? "")
    .setQueryItem("post_type", "wp-manga");
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

export const fetchHomePage = (): Promise<cheerio.CheerioAPI> => fetchDocument(`${DOMAIN}/`);

export const fetchBrowsePage = (page: number, sortBy: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(buildBrowseUrl(page, sortBy));

export const fetchSearchPage = (
  page: number,
  request: SearchRequest,
): Promise<cheerio.CheerioAPI> => fetchDocument(buildSearchUrl(page, request));

export const fetchLatestPage = (page: number): Promise<cheerio.CheerioAPI> =>
  fetchDocument(page > 1 ? `${DOMAIN}/new/page/${page}/` : `${DOMAIN}/new/`);

export const fetchMangaPage = (mangaId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(new URL(DOMAIN).addPathComponent("manga").addPathComponent(mangaId).toString());

export const fetchChapterList = async (mangaId: string): Promise<cheerio.CheerioAPI> => {
  const referer = `${DOMAIN}/manga/${mangaId}/`;
  return cheerio.load(await postText(`${referer}ajax/chapters`, referer));
};

export const fetchReaderPage = (mangaId: string, chapterId: string): Promise<cheerio.CheerioAPI> =>
  fetchDocument(
    new URL(DOMAIN)
      .addPathComponent("manga")
      .addPathComponent(mangaId)
      .addPathComponent(chapterId)
      .setQueryItem("style", "list")
      .toString(),
  );
