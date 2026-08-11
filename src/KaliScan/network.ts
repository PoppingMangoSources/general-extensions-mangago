/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { getAutomaticFailover, getBaseUrl, getSelectedBaseUrl, setActiveBaseUrl } from "./forms";
import { MIRRORS } from "./models";

export const completeMobileSafariUserAgent = (userAgent: string): string => {
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

// One native lookup for the whole session instead of one per request.
let userAgentPromise: Promise<string> | undefined;
const getUserAgent = (): Promise<string> =>
  (userAgentPromise ??= Application.getDefaultUserAgent().then(completeMobileSafariUserAgent));

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i;
const MIRROR_IDS = MIRRORS.map((mirror) => mirror.id);
const RETRYABLE_STATUS = new Set([403, 408, 500, 502, 503, 504, 521, 522, 523, 524]);

const mirrorOrigin = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}://${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    return MIRROR_IDS.includes(origin) ? origin : undefined;
  } catch {
    return undefined;
  }
};

export class KaliScanInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    const headers = { ...request.headers };
    if (isImage) {
      delete headers.origin;
      delete headers.Origin;
    }

    return {
      ...request,
      headers: {
        ...headers,
        referer: `${mirrorOrigin(request.url) ?? getBaseUrl()}/`,
        "user-agent": await getUserAgent(),
        "accept-language": "en-US,en;q=0.5",
        accept: isImage
          ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
          : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const body = response.status === 403 ? Application.arrayBufferToUTF8String(data) : "";
    if (
      response.headers?.["cf-mitigated"] === "challenge" ||
      (response.status === 403 &&
        /(?:Just a moment|cf-chl-|_cf_chl_opt|challenge-platform)/i.test(body))
    ) {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await getUserAgent() },
      });
    }
    return data;
  }
}

export const fetchHtml = async (url: string): Promise<string> => {
  const requestedOrigin = mirrorOrigin(url);
  const origins = getAutomaticFailover()
    ? [requestedOrigin, getSelectedBaseUrl(), ...MIRROR_IDS].filter(
        (origin, index, values): origin is string =>
          Boolean(origin) && values.indexOf(origin) === index,
      )
    : requestedOrigin
      ? [requestedOrigin]
      : [];
  const candidates =
    origins.length > 0 && requestedOrigin
      ? origins.map((origin) => url.replace(requestedOrigin, origin))
      : [url];

  let lastError: unknown;

  for (const [index, candidate] of candidates.entries()) {
    try {
      const [response, buffer] = await Application.scheduleRequest({
        url: candidate,
        method: "GET",
      });

      if (response.status === 200) {
        const successfulOrigin = mirrorOrigin(candidate);
        if (successfulOrigin) setActiveBaseUrl(successfulOrigin);
        return Application.arrayBufferToUTF8String(buffer);
      }
      if (response.status === 404) {
        lastError = new Error(`Content not found: ${candidate}`);
        break;
      }

      const error = new Error(`Request failed with status ${response.status}: ${candidate}`);
      lastError = error;
      if (!RETRYABLE_STATUS.has(response.status) || index === candidates.length - 1) break;
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      lastError = error;
      if (index === candidates.length - 1) break;
    }
  }

  throw lastError ?? new Error(`Request failed: ${url}`);
};
