/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { DOMAIN } from "../models";

// Pin a reader URL/path to the host that serves it (www.mangago.me, or a mirror
// for numeric readers) and repair accidental host-doubling (a stale
// ".../https://www.mangago.me/read-manga/..." that 404s).
export function canonicalReaderUrl(url: string): string {
  // Split off any query/fragment so a "/read-manga/" inside a query can't be
  // mistaken for the real path.
  const queryStart = url.search(/[?#]/);
  let beforeQuery = queryStart === -1 ? url : url.slice(0, queryStart);
  const suffix = queryStart === -1 ? "" : url.slice(queryStart);

  // Host-doubling backstop with no reader segment to anchor on: keep only the last
  // absolute-URL occurrence. Normalize a leading "//host" to https first.
  if (beforeQuery.startsWith("//")) beforeQuery = `https:${beforeQuery}`;
  const schemeMatches = [...beforeQuery.matchAll(/https?:\/\//g)];
  if (schemeMatches.length > 1) {
    beforeQuery = beforeQuery.slice(schemeMatches[schemeMatches.length - 1]!.index);
  }

  // Preserve an explicit mirror host (mangago.zone / youhim.me) for numeric paths
  // — the numeric reader 404s on www.mangago.me; everything else pins to www.
  const inputHost = readerHostOf(beforeQuery);
  const mirrorOrigin =
    inputHost && isReaderMirrorHost(inputHost) ? `https://${inputHost}` : undefined;

  const readerIndex = Math.max(
    beforeQuery.lastIndexOf("/read-manga/"),
    beforeQuery.lastIndexOf("/chapter/"),
  );
  const working = (readerIndex > 0 ? beforeQuery.slice(readerIndex) : beforeQuery) + suffix;
  const pathSearchHash = readerPathAndQuery(working);
  const numeric = /^\/chapter\/\d+\/\d+/.test(readerPathOf(working));
  const origin = numeric && mirrorOrigin ? mirrorOrigin : DOMAIN;
  return `${origin}${pathSearchHash}`;
}

// Host/path of an absolute reader URL via plain string ops: `new URL(absolute,
// base)` folds a mirror host back to www.mangago.me in the on-device polyfill,
// re-pinning a numeric mirror reader. `new URL` is reserved for relative inputs.
export function readerHostOf(url: string): string | undefined {
  const n = url.startsWith("//") ? `https:${url}` : url;
  return /^https?:\/\/([^/?#]+)/i.exec(n)?.[1]?.toLowerCase();
}

// Origin serving a reader URL — its explicit mirror host, else www.mangago.me.
export function readerOrigin(url: string): string {
  const host = readerHostOf(url);
  return host ? `https://${host}` : DOMAIN;
}

export function readerPathAndQuery(url: string): string {
  const n = url.startsWith("//") ? `https:${url}` : url;
  const abs = /^https?:\/\/[^/]+(\/[^\s]*)?$/i.exec(n);
  return abs ? abs[1] || "/" : n.startsWith("/") ? n : `/${n}`;
}

export function readerPathOf(url: string): string {
  const ps = readerPathAndQuery(url);
  const cut = ps.search(/[?#]/);
  return cut >= 0 ? ps.slice(0, cut) : ps;
}

// Hosts that can serve a numeric /chapter/ reader; www.mangago.me 404s them, so
// getMangagoPageUrls tries each and uses whichever returns the imgsrcs page.
const READER_MIRROR_HOSTS = [DOMAIN, "https://www.mangago.zone", "https://www.youhim.me"];

export function numericChapterCandidates(url: string): string[] {
  const pathSearch = readerPathAndQuery(url);
  if (!/^\/chapter\/\d+\/\d+/.test(pathSearch)) return [];
  return READER_MIRROR_HOSTS.map((host) => `${host}${pathSearch}`);
}

// The rotating mirror hosts that serve the numeric reader (NOT www.mangago.me).
export function isReaderMirrorHost(host: string): boolean {
  return /(?:^|\.)(?:mangago\.zone|youhim\.me)$/i.test(host);
}

export function absoluteUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${DOMAIN}${url}`;
  return `${DOMAIN}/${url}`;
}

export function resolveUrl(url: string, baseUrl: string): string {
  // Absolute URLs pass through — `new URL(absolute, base)` is the form the polyfill
  // mis-resolves; only relative inputs get base resolution.
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("//")) return `https:${url}`;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return absoluteUrl(url);
  }
}
