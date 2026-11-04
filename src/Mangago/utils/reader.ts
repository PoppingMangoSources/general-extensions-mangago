/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { CloudflareError } from "@paperback/types";

import { DOMAIN, READER_USER_AGENT } from "../models";
import { fetchPage } from "../network";
import {
  aesCbcDecrypt,
  base64ToArrayBuffer,
  decodeHex,
  extractDescrambleCols,
  extractImgsrcs,
  findHexEncodedVariable,
  getDescramblingKey,
  sojsonV4Decode,
  unscrambleImageList,
} from "./crypto";
import {
  absoluteUrl,
  canonicalReaderUrl,
  numericChapterCandidates,
  readerOrigin,
  resolveUrl,
} from "./urls";

// Sec-Fetch-* headers a browser sends when navigating to a reader page. With the
// same-origin referer/origin they make a sub-page fetch look like a real
// navigation, which mangago serves in full. Reader-page HTML only — image
// requests have a different Sec-Fetch context.
const READER_NAVIGATION_HEADERS: Record<string, string> = {
  "sec-fetch-site": "same-origin",
  "sec-fetch-mode": "navigate",
  "sec-fetch-dest": "document",
  "sec-fetch-user": "?1",
};

// In-memory caches for the deobfuscated chapter.js and final page URLs.
const mangagoPageUrlsCache = new Map<string, string[]>();
const chapterJsCache = new Map<string, string>();

// Persistent chapter.js cache key prefix; the versioned URL makes a bump auto-miss.
const CHAPTER_JS_STATE_PREFIX = "mangago-chapterjs:";

const READER_FETCH_MIN_INTERVAL_MS = 350;
let lastReaderFetchAt = 0;

async function paceReaderFetch(): Promise<void> {
  const waitMs = READER_FETCH_MIN_INTERVAL_MS - (Date.now() - lastReaderFetchAt);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastReaderFetchAt = Date.now();
}

function extractTotalPages(html: string): number {
  const candidates = [
    /total_pages\s*=\s*["']?(\d+)/.exec(html)?.[1],
    /class=["'][^"']*multi_pg_tip[^"']*["'][^>]*>\s*\(\s*\d+\s*\/\s*(\d+)\s*\)/i.exec(html)?.[1],
    /page\s+\d+\s+of\s+(\d+)/i.exec(html)?.[1],
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

// The reader-page URL template from input#curl, e.g. "/chapter/35134/2096487/{page}/".
// An unusable "/" curl (no {page}) returns undefined so the caller falls back to pcurl.
function extractCurlTemplate(html: string): string | undefined {
  const value = /<input[^>]*id=["']curl["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1]?.trim();
  if (!value || !value.includes("{page}")) return undefined;
  // Keep only the pathname so later path merging can't turn it into /https://...
  return templatePathname(value);
}

// Some read-manga pages ship an unusable curl value of "/" and put the current page
// URL in the pcurl variable instead; turn that pg-N URL into the {page} template.
function extractPcurlTemplate(html: string): string | undefined {
  const match = /\bpcurl\s*=\s*["']([^"']*\/pg-)\d+(\/[^"']*)?["']/.exec(html);
  if (!match?.[1]) return undefined;

  return templatePathname(`${match[1]}{page}${match[2] ?? ""}`);
}

// Mangago's "not found" body — a definitive 404, not a transient failure.
function isMangago404Page(html: string): boolean {
  return (
    /<title>\s*404\s*-\s*mangago\s*<\/title>/i.test(html) ||
    /the page you have requested is not available/i.test(html)
  );
}

function extractChapterJsUrl(html: string): string | undefined {
  const match =
    html.match(/<script\b[^>]+src=["']([^"']*chapter\.js[^"']*)["'][^>]*>/i) ??
    html.match(/src=["']([^"']*chapter\.js[^"']*)["']/i);
  return match?.[1];
}

function extractImgsrcsFromHtml(html: string): string | undefined {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1] ?? "",
  );
  const imgsrcsScript = scripts.find((s) => s.includes("imgsrcs"));
  return imgsrcsScript ? extractImgsrcs(imgsrcsScript) : undefined;
}

function templatePathname(template: string): string {
  const placeholder = "__MANGAGO_PAGE_PLACEHOLDER__";
  const protectedTemplate = template.replace(/\{page\}/g, placeholder);

  try {
    return new URL(protectedTemplate, DOMAIN).pathname.replaceAll(placeholder, "{page}");
  } catch {
    return template;
  }
}

type ReaderCrypto = { deobfChapterJs: string; keyHex: string; ivHex: string; cols: number };

// Decrypt + unscramble a reader page's imgsrcs blob into raw image URLs.
async function decodeImgsrcsBlob(
  imgsrcsRaw: string,
  deobfChapterJs: string,
  keyHex: string,
  ivHex: string,
  keepBlanks = false,
): Promise<string[]> {
  const encrypted = base64ToArrayBuffer(imgsrcsRaw);

  return aesCbcDecrypt(encrypted, decodeHex(keyHex), decodeHex(ivHex)).then((decryptedBuffer) => {
    // Application converter, not a global TextDecoder (not guaranteed on-device).
    let decryptedText = Application.arrayBufferToUTF8String(decryptedBuffer);

    const nulChar = String.fromCharCode(0);
    while (decryptedText.endsWith(nulChar)) {
      decryptedText = decryptedText.slice(0, -1);
    }

    decryptedText = decryptedText.replace(/,+$/g, "");

    const imageList = unscrambleImageList(decryptedText, deobfChapterJs);

    const images = imageList.split(",").map((x) => x.trim());
    return keepBlanks ? images : images.filter(Boolean);
  });
}

// Append the descramble fragment for scrambled (cspiclink) images so the
// interceptor can unscramble them; other images pass through.
function annotateImageUrl(rawUrl: string, deobfChapterJs: string, cols: number): string {
  const abs = absoluteUrl(rawUrl);

  if (!abs.includes("cspiclink") || !cols) return abs;

  try {
    const desckey = getDescramblingKey(deobfChapterJs, abs);
    return `${abs}#desckey=${encodeURIComponent(desckey)}&cols=${encodeURIComponent(String(cols))}`;
  } catch {
    return abs;
  }
}

// Validate a deobfuscated chapter.js before trusting it (a persisted one could be
// truncated or stale). Every marker the decode pipeline needs must be present.
function isUsableDeobfChapterJs(js: unknown): js is string {
  return (
    typeof js === "string" &&
    js.length > 1000 &&
    !!findHexEncodedVariable(js, "key") &&
    !!findHexEncodedVariable(js, "iv") &&
    extractDescrambleCols(js) > 0 &&
    js.includes("var renImg = function(img,width,height,id){") &&
    js.includes("key = key.split(")
  );
}

async function getCachedDeobfChapterJs(chapterJsUrl: string): Promise<string> {
  const cached = chapterJsCache.get(chapterJsUrl);
  if (cached) return cached;

  // Persistent cache keyed by the versioned script URL, so a version bump misses.
  const stateKey = `${CHAPTER_JS_STATE_PREFIX}${chapterJsUrl}`;
  const persisted = Application.getState(stateKey);
  if (isUsableDeobfChapterJs(persisted)) {
    chapterJsCache.set(chapterJsUrl, persisted);
    return persisted;
  }

  const { html } = await fetchPage(chapterJsUrl);
  const deobf = sojsonV4Decode(html);
  chapterJsCache.set(chapterJsUrl, deobf);

  // Only persist a validated value, so a bad decode isn't frozen into state.
  if (isUsableDeobfChapterJs(deobf)) Application.setState(deobf, stateKey);

  return deobf;
}

// Fetch one reader page (with its serving origin). `outcome.dead` marks Mangago's
// definitive 404 vs. a retryable failure, so the fallback crawl can tell them apart.
type ReaderFetchOutcome = { dead: boolean };

async function fetchReaderPage(
  pageUrl: string,
  outcome?: ReaderFetchOutcome,
): Promise<{ html: string; url: string; origin: string } | undefined> {
  // Pin to a host that serves the page: read-manga -> www.mangago.me; numeric
  // /chapter/ keeps its mirror host (www 404s those).
  pageUrl = canonicalReaderUrl(pageUrl);

  const pageOrigin = readerOrigin(pageUrl);

  // Retry across a few rounds with a short backoff, since a page can transiently
  // fail (rate-limit, -999 cancel, momentary network) and the walk treats one
  // failed page as the chapter's end. A Cloudflare challenge surfaces below.
  let cloudflareError: CloudflareError | undefined;
  let definitive404 = false;

  const MAX_ROUNDS = 3;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    try {
      await paceReaderFetch();
      const { html } = await fetchPage(pageUrl, {
        // Desktop reader UA only; the interceptor merges _m_superu alongside any
        // Cloudflare-bypass cookies, so we don't set a bare cookie header.
        "user-agent": READER_USER_AGENT,
        ...READER_NAVIGATION_HEADERS,
      });
      if (extractImgsrcsFromHtml(html)) {
        return { html, url: pageUrl, origin: pageOrigin };
      }
      if (isMangago404Page(html)) {
        definitive404 = true;
        break;
      }
    } catch (error) {
      if (error instanceof CloudflareError) cloudflareError = error;
    }

    if (round < MAX_ROUNDS) {
      await new Promise((resolve) => setTimeout(resolve, 400 * round));
    }
  }

  if (cloudflareError) throw cloudflareError;

  if (outcome) outcome.dead = definitive404;
  return undefined;
}

async function decodeReaderPageImages(
  pageUrl: string,
  deobfChapterJs: string,
  keyHex: string,
  ivHex: string,
  keepBlanks = false,
  outcome?: ReaderFetchOutcome,
): Promise<{ images: string[]; html: string; url: string; origin: string } | undefined> {
  const result = await fetchReaderPage(pageUrl, outcome);
  if (!result) return undefined;

  const imgsrcs = extractImgsrcsFromHtml(result.html);
  if (!imgsrcs) return undefined;

  const images = await decodeImgsrcsBlob(imgsrcs, deobfChapterJs, keyHex, ivHex, keepBlanks);
  if (!images.some(Boolean)) return undefined;

  return { ...result, images };
}

// Fetch the first usable reader page. Tries the canonical URL, then every numeric
// mirror (www.mangago.me 404s numeric-only titles). Returns the HTML and the
// host-correct URL the walk should key off.
async function resolveInitialReaderPage(
  chapterUrl: string,
): Promise<{ html: string; loadedUrl: string }> {
  const canonical = canonicalReaderUrl(chapterUrl);
  const candidates: string[] = [];
  const addCandidate = (candidate: string): void => {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  // www stays first so a numeric URL that redirects to its /read-manga/ reader
  // still takes the fast path.
  addCandidate(canonical);
  for (const mirror of numericChapterCandidates(canonical)) addCandidate(mirror);

  let cloudflareError: CloudflareError | undefined;

  for (const candidate of candidates) {
    try {
      const { html: attempt, finalUrl } = await fetchPage(candidate, {
        "user-agent": READER_USER_AGENT,
        ...READER_NAVIGATION_HEADERS,
      });
      if (attempt.includes("imgsrcs")) {
        // Key off the final URL (after any numeric -> read-manga redirect) so
        // same-chapter next_page links match; a numeric reader stays on its mirror.
        return { html: attempt, loadedUrl: canonicalReaderUrl(finalUrl) };
      }
    } catch (error) {
      if (error instanceof CloudflareError) cloudflareError = error;
    }
  }

  if (cloudflareError) throw cloudflareError;
  throw new Error("[Mangago] no usable chapter page");
}

async function loadReaderCrypto(html: string, loadedUrl: string): Promise<ReaderCrypto> {
  const chapterJsSrc = extractChapterJsUrl(html);
  if (!chapterJsSrc) throw new Error("Could not find chapter.js URL");

  const deobfChapterJs = await getCachedDeobfChapterJs(resolveUrl(chapterJsSrc, loadedUrl));
  const keyHex = findHexEncodedVariable(deobfChapterJs, "key");
  const ivHex = findHexEncodedVariable(deobfChapterJs, "iv");
  if (!keyHex) throw new Error("Could not find AES key");
  if (!ivHex) throw new Error("Could not find AES IV");

  return { deobfChapterJs, keyHex, ivHex, cols: extractDescrambleCols(deobfChapterJs) };
}

// Build the URL for image index `page` by substituting {page} into the curl
// template (already a full pathname) and pinning it to the loaded reader's host —
// the mirror, for numeric readers; www 404s those.
function buildTemplatePageUrl(template: string, loadedUrl: string, page: number): string {
  const origin = readerOrigin(loadedUrl);
  const path = template.replace("{page}", String(page));
  return canonicalReaderUrl(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
}

export async function getMangagoPageUrls(chapterUrl: string): Promise<string[]> {
  const cachedPages = mangagoPageUrlsCache.get(chapterUrl);
  if (cachedPages && cachedPages.length > 0) return cachedPages;

  const { html, loadedUrl } = await resolveInitialReaderPage(chapterUrl);

  const imgsrcsRaw = extractImgsrcsFromHtml(html);
  if (!imgsrcsRaw) throw new Error("Could not extract imgsrcs");

  const crypto = await loadReaderCrypto(html, loadedUrl);

  const annotate = (urls: string[]): string[] =>
    urls.map((url) => annotateImageUrl(url, crypto.deobfChapterJs, crypto.cols));

  // Page 1's image list, positional (blanks mark slots served by other windows).
  const firstPositional = await decodeImgsrcsBlob(
    imgsrcsRaw,
    crypto.deobfChapterJs,
    crypto.keyHex,
    crypto.ivHex,
    true,
  );

  const totalPages = extractTotalPages(html);

  // Fast path: the desktop reader UA returns the whole chapter on page 1 — a
  // gapless list of at least the reported page count. Covers every read-manga reader.
  if (
    firstPositional.length > 0 &&
    firstPositional.every((url) => url.trim() !== "") &&
    (totalPages === 0 || firstPositional.length >= totalPages)
  ) {
    const pages = annotate(firstPositional);
    mangagoPageUrlsCache.set(chapterUrl, pages);
    return pages;
  }

  // Windowed (numeric mirror) reader: page N carries image N at positional slot
  // N-1. Fill the slots from the curl template, fetching only the gaps.
  const template = extractCurlTemplate(html) ?? extractPcurlTemplate(html);
  if (totalPages <= 0 || !template) {
    // No template to walk — best-effort return of whatever page 1 held (uncached).
    return annotate(firstPositional.filter(Boolean));
  }

  const slots: string[] = Array.from({ length: totalPages }, () => "");
  const fillSlots = (positional: string[]): void => {
    for (let i = 0; i < positional.length && i < totalPages; i++) {
      const url = positional[i]?.trim();
      if (url && !slots[i]) slots[i] = url;
    }
  };
  fillSlots(firstPositional);

  let complete = true;
  for (let page = 1; page <= totalPages; page++) {
    if (slots[page - 1]) continue; // already filled by an earlier window
    const result = await decodeReaderPageImages(
      buildTemplatePageUrl(template, loadedUrl, page),
      crypto.deobfChapterJs,
      crypto.keyHex,
      crypto.ivHex,
      true,
    );
    if (!result) {
      complete = false; // fetchReaderPage already retried; leave the slot blank
      continue;
    }
    fillSlots(result.images);
  }

  const rawImages = slots.filter(Boolean);
  const pages = annotate(rawImages);
  // Cache only a complete chapter, so a partial one retries on reopen.
  if (pages.length > 0 && complete && rawImages.length === totalPages) {
    mangagoPageUrlsCache.set(chapterUrl, pages);
  }
  return pages;
}
