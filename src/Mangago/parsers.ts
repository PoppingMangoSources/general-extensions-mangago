/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  URL,
  type Chapter,
  type MangaInfo,
  type SortingOption,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";

import { getContentType, getHiddenGenreIds } from "./forms/settings";
import {
  DOMAIN,
  genreIdFromTitle,
  getGenreTitle,
  MANHWA_TOP_SECTION_IDS,
  RELATIVE_UNIT_MS,
  SORT_OPTIONS,
  type FeaturedDetail,
  type MangagoListing,
  type MangagoSearchMetadata,
} from "./models";
import { absoluteUrl, canonicalReaderUrl, encodeMangaId } from "./utils/urls";

// Only "Official" is special-cased; every other group name is extracted
// dynamically from the chapter title's [brackets]/(parens) or the uploader field.
function isOfficialUpload(text: string): boolean {
  return /\bofficial\b/i.test(text);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Cover/thumbnail src, preferring lazy-load attrs over the placeholder `src`.
function imgSrc($img: cheerio.Cheerio<Element>): string {
  return absoluteUrl(
    $img.attr("data-src") ??
      $img.attr("data-cfsrc") ??
      $img.attr("data-lazy-src") ??
      $img.attr("srcset")?.split(/\s+/)[0] ??
      $img.attr("src") ??
      "",
  );
}

function normalizeGroup(raw: string): string {
  const text = normalizeWhitespace(raw);
  if (!text) return "";

  return isOfficialUpload(text) ? "Official" : text;
}

function detectGroupFromBracket(title: string): string {
  const bracketMatches = title.matchAll(/(?:\[([^\]]{2,80})\]|\(([^()]{2,80})\))/g);

  for (const match of bracketMatches) {
    const value = normalizeWhitespace(match[1] ?? match[2] ?? "");
    if (!value) continue;

    if (isOfficialUpload(value)) return "Official";

    if (/\b(scans?|scanlations?|translations?|translators?|team|group)\b/i.test(value)) {
      return value;
    }
  }

  return "";
}

function buildVersion(group: string, uploader: string): string | undefined {
  if (!group) return uploader || undefined;
  if (!uploader || group.toLowerCase() === uploader.toLowerCase()) return group;

  return `${group} - ${uploader}`;
}

export function buildChapterVersion(rawUploader: string, rawTitle = ""): string | undefined {
  const uploader = normalizeGroup(rawUploader);
  const group = detectGroupFromBracket(rawTitle) || (isOfficialUpload(rawTitle) ? "Official" : "");

  return buildVersion(group, uploader);
}

function firstUploaderCandidate(candidates: string[], chapterTitle: string): string {
  return (
    candidates.map(normalizeWhitespace).find(
      (candidate) =>
        candidate &&
        candidate !== chapterTitle &&
        // Skip the substring test when the chapter title is empty — otherwise
        // `candidate.includes("")` is always true and every uploader is rejected.
        (!chapterTitle || !candidate.includes(chapterTitle)),
    ) ?? ""
  );
}

function extractUploader($row: cheerio.Cheerio<Element>): string {
  const chapterTitle = normalizeWhitespace($row.find("a.chico").first().text());

  const profileUploader = firstUploaderCandidate(
    $row
      .find("a[href*='/home/'], a[href*='/user/'], a[href*='/profile/']")
      .not("a.chico")
      .toArray()
      .map((element) => $row.find(element).text()),
    chapterTitle,
  );
  if (profileUploader) return profileUploader;

  // Uploader and date cells share class "no"; the date is always the last cell,
  // so exclude it (and its anchors) positionally instead of sniffing content.
  const $dateCell = $row.find("td").last();
  const cellCandidates = $row
    .find(
      "td.no a, td.no, td.uk-table-shrink a, td.uk-table-shrink, td[class*='upload'] a, td[class*='upload'], td[class*='group'] a, td[class*='group']",
    )
    .not($dateCell)
    .not($dateCell.find("a"))
    .toArray()
    .map((element) => $row.find(element).text());

  return firstUploaderCandidate(cellCandidates, chapterTitle);
}

function toPathname(href: string): string {
  const normalizedHref = href.trim();
  if (!normalizedHref) return "";

  // The URL builder needs an absolute input (it throws on a bare path).
  try {
    return encodeMangaId(new URL(absoluteUrl(normalizedHref)).path);
  } catch {
    return encodeMangaId(normalizedHref);
  }
}

export function parseListings(html: string): MangagoListing[] {
  const $ = cheerio.load(html);
  const items: MangagoListing[] = [];
  const seen = new Set<string>();

  $(".updatesli, .pic_list > li").each((_, element) => {
    const $item = $(element);
    const $link = $item.find("a.thm-effect").first();
    if ($link.length === 0) return;

    const mangaId = toPathname($link.attr("href") ?? "");
    if (!mangaId || seen.has(mangaId)) return;

    const $img = $link.find("img").first();
    const title = normalizeWhitespace($link.attr("title") ?? $img.attr("alt") ?? $link.text());
    if (!title) return;

    // Latest-chapter link, shown as the tile subtitle when it isn't the manga link.
    const $chapter = $item.find(".chapter a, a[href*='/read-manga/'][href*='/c']").first();
    const chapterPath = $chapter.attr("href") ? toPathname($chapter.attr("href")!) : "";
    const isChapter = chapterPath !== "" && chapterPath !== mangaId;

    seen.add(mangaId);
    items.push({
      mangaId,
      title,
      imageUrl: imgSrc($img),
      subtitle: isChapter ? normalizeWhitespace($chapter.text()) || undefined : undefined,
      chapterId: isChapter ? chapterPath : undefined,
    });
  });

  return items;
}

export function hasNextPage(html: string): boolean {
  return cheerio.load(html)(".current + li > a").length > 0;
}

function parseRelativeTime(text: string): Date | undefined {
  const match = text.toLowerCase().match(/(\d+)\s*(second|minute|hour|day|week|month|year)/);
  if (match) {
    const amount = Number(match[1]);
    const unitMs = RELATIVE_UNIT_MS[match[2]!];
    if (unitMs) return new Date(Date.now() - amount * unitMs);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

// The /list/latest/ page carries update time + genres + latest-chapter links per
// title, so the New Chapters section uses it instead of the plain /genre/ grid.
export function parseLatestUpdates(html: string): MangagoListing[] {
  const $ = cheerio.load(html);
  const items: MangagoListing[] = [];
  const seen = new Set<string>();

  // Mobile/desktop layouts differ; both wrap the title in .row-1 with the other
  // rows as siblings and the cover preceding. Anchor on the title for a stable scope.
  $(".row-1 .tit a").each((_, element) => {
    const $titleLink = $(element);
    const href = $titleLink.attr("href") ?? "";
    if (!href.includes("/read-manga/")) return;

    const mangaId = toPathname(href);
    if (!mangaId || seen.has(mangaId)) return;

    const title = normalizeWhitespace($titleLink.attr("title") ?? $titleLink.text());
    if (!title) return;

    const $content = $titleLink.closest(".row-1").parent();

    const $img = $content.prev().find("img").first();
    const imageUrl = imgSrc($img);

    const $chapter = $content.find("a.chico").first();
    const subtitle = normalizeWhitespace($chapter.text());
    const chapterId = $chapter.attr("href") ? toPathname($chapter.attr("href")!) : undefined;

    // "Update Date: <relative time>" — in .row-1 (desktop) or a sibling .row-3 (mobile).
    let publishDate: Date | undefined;
    $content.find(".blue").each((_, label) => {
      const $label = $(label);
      if ($label.text().trim().toLowerCase().startsWith("update date")) {
        publishDate = parseRelativeTime(
          normalizeWhitespace($label.parent().text()).replace(/^update date:\s*/i, ""),
        );
      }
    });

    const genres = $content
      .find(".row-4 .gray")
      .text()
      .split(/[/,]/)
      .map((genre) => normalizeWhitespace(genre))
      .filter(Boolean);

    seen.add(mangaId);
    items.push({
      mangaId,
      title,
      imageUrl,
      subtitle: subtitle || undefined,
      chapterId: chapterId || undefined,
      publishDate,
      genres: genres.length ? genres : undefined,
    });
  });

  return items;
}

// Iterate a detail page's info rows (mobile `.manga_info li` / desktop `.manga_right
// tr`) as (lowercased label, row) pairs — shared by both detail parsers.
function eachInfoRow(
  $: cheerio.CheerioAPI,
  fn: (label: string, $row: cheerio.Cheerio<Element>) => void,
): void {
  $("#information .manga_info li, #information .manga_right tr").each((_, element) => {
    const $row = $(element);
    fn($row.find("b, label").first().text().trim().toLowerCase(), $row);
  });
}

// span.rating_num, the 0–10 score as shown; undefined when absent/non-numeric.
function ratingText($: cheerio.CheerioAPI): string | undefined {
  const text = $(".rating_num").first().text().replace(/\s+/g, "");
  return /^\d+(?:\.\d+)?$/.test(text) ? text : undefined;
}

// .manga_summary with its trailing <font> credit line stripped.
function mangaSummary($: cheerio.CheerioAPI): string | undefined {
  const el = $(".manga_summary").first();
  el.find("font").remove();
  return el.text().trim() || undefined;
}

export function parseFeaturedDetail(html: string): FeaturedDetail {
  const $ = cheerio.load(html);

  let status: string | undefined;
  let author: string | undefined;
  eachInfoRow($, (label, $row) => {
    if (label.startsWith("status")) {
      const value = $row.find("span").first().text().trim();
      if (value) status = value;
    } else if (label.startsWith("author")) {
      const names = $row
        .find("a")
        .map((_index, anchor) => $(anchor).text().trim())
        .get()
        .filter(Boolean);
      if (names.length > 0) author = names.join(", ");
    }
  });

  return { rating: ratingText($), status, author, summary: mangaSummary($) };
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
  const $ = cheerio.load(html);
  const normalizedMangaId = toPathname(mangaId) || mangaId;

  const info = $("#information");

  const title = $(".w-title h1").first().text().trim() || normalizedMangaId;
  const imageUrl = imgSrc(info.find("img").first());

  const description = mangaSummary($) ?? "";

  let status: MangaInfo["status"] = "UNKNOWN";
  let author = "";
  let artist = "";
  const secondaryTitles: string[] = [];
  const tags: Tag[] = [];
  const tagTitles: string[] = [];

  eachInfoRow($, (label, $el) => {
    const value = $el.find("span").first().text().trim();

    if (label.startsWith("status")) {
      const statusValue = value.toLowerCase();

      if (statusValue === "ongoing") status = "ONGOING";
      else if (statusValue === "completed") status = "COMPLETED";
    }

    if (label.startsWith("author")) {
      author = $el
        .find("a")
        .map((_, a) => $(a).text().trim())
        .get()
        .join(", ");
    }

    if (label.startsWith("artist")) {
      artist = $el
        .find("a")
        .map((_, a) => $(a).text().trim())
        .get()
        .join(", ");
    }

    // Alternative names improve search + tracker matching (best-effort). mangago
    // separates them with ; / or newlines.
    if (label.startsWith("alternative") || label.includes("other name")) {
      const raw = value || $el.text().replace(/^[^:]*:/, "");
      for (const name of raw.split(/[;/\n]+/).map((s) => s.trim())) {
        if (name && !secondaryTitles.includes(name)) secondaryTitles.push(name);
      }
    }

    if (label.startsWith("genre")) {
      $el.find("a").each((_, a) => {
        const genreTitle = $(a).text().trim();
        if (!genreTitle) return;

        // Derive the id the same way as GENRE_OPTIONS so a tapped tag round-trips
        // through the genre filter (makeSafeId's `-` form did not match).
        tagTitles.push(genreTitle);
        tags.push({ id: genreIdFromTitle(genreTitle), title: genreTitle });
      });
    }
  });

  // rating_num is 0–10; MangaInfo.rating is 0–1 (rendered as a percentage star).
  const ratingNum = Number(ratingText($));
  const rating = Number.isFinite(ratingNum) ? Math.min(1, Math.max(0, ratingNum / 10)) : 0;

  return {
    mangaId: normalizedMangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles,
      thumbnailUrl: imageUrl || `${DOMAIN}/favicon.ico`,
      synopsis: description,
      author,
      artist,
      status,
      rating,
      contentRating: contentRatingForGenres(tagTitles),
      tagGroups: [
        {
          id: "genres",
          title: "Genres",
          tags,
        },
      ],
    },
  };
}

function parseChapterTitle(input: string): {
  chapter?: number;
  title?: string;
} {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(":");

  let left = colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed;
  const right = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";

  let chapter: number | undefined;
  let title: string | undefined;

  const volumeMatch = /^Vol\.\s*(?:(\d+(?:\.\d+)?)|TBA|N\/?A|NA)?\s*/i.exec(left);
  if (volumeMatch) {
    left = left.slice(volumeMatch[0].length).trimStart();
  }

  if (/^Ch\./i.test(left)) {
    left = left.slice(3).trimStart();
    const match = /^(\d+(?:\.\d+)?)/.exec(left);
    if (match) {
      chapter = Number(match[1]);
      left = left.slice(match[1].length).trimStart();
    }
  }

  if (right && left) title = `${left}: ${right}`;
  else if (right) title = right;
  else if (left) title = left;

  return { chapter, title };
}

function parseChapterNumber(name: string): number {
  // No slug fallback: the slug's number is an upload id, not the chapter number.
  // A name with no number stays 0 (the sort's "unnumbered" sentinel).
  const rawNumber =
    name.match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1] ??
    name.match(/ch\.\s*(\d+(?:\.\d+)?)/i)?.[1] ??
    // Last resort: only a leading number is likely the chapter number; a number
    // mid-title (e.g. "Season 2 …") is not, so it stays the 0 sentinel.
    name.match(/^\s*(\d+(?:\.\d+)?)/)?.[1];

  const number = rawNumber ? Number(rawNumber) : 0;
  return Number.isFinite(number) ? number : 0;
}

function compareChapterGroups(a: Chapter, b: Chapter): number {
  const aOfficial = a.version?.startsWith("Official") ?? false;
  const bOfficial = b.version?.startsWith("Official") ?? false;

  if (aOfficial && !bOfficial) return -1;
  if (!aOfficial && bOfficial) return 1;

  return (a.version ?? "").localeCompare(b.version ?? "");
}

export function parseChapters(html: string, sourceManga: SourceManga): Chapter[] {
  const $ = cheerio.load(html);
  const chapters: Chapter[] = [];

  $("table#chapter_table > tbody > tr, table.uk-table > tbody > tr").each((_, element) => {
    const $row = $(element);
    const $link = $row.find("a.chico").first();

    const href = ($link.attr("href") ?? "").trim();
    if (!href) return;

    // Keep an absolute href (a numeric mirror URL) intact so the id alone can fetch;
    // relative hrefs reduce to their pathname (matches Kotlin's chapterListParse).
    const chapterId = href.startsWith("http") ? canonicalReaderUrl(href) : toPathname(href);
    if (!chapterId) return;

    const rawTitle = $link.text().trim();
    const parsed = parseChapterTitle(rawTitle);
    const rawUploader = extractUploader($row);
    const version = buildChapterVersion(rawUploader, rawTitle);
    const chapNum = parsed.chapter ?? parseChapterNumber(rawTitle);
    const title = parsed.title || rawTitle;

    // Chapters carry an absolute "MMM d, yyyy" date in the last cell.
    const publishDate = parseRelativeTime(normalizeWhitespace($row.find("td").last().text()));

    const chapter: Chapter = {
      chapterId,
      sourceManga,
      title,
      chapNum,
      volume: 0,
      version,
      publishDate,
      langCode: "en",
      sortingIndex: 0,
    };

    chapters.push(chapter);
  });

  chapters.sort((a, b) => {
    if (a.chapNum === 0 && b.chapNum === 0) return compareChapterGroups(a, b);
    if (a.chapNum === 0) return 1;
    if (b.chapNum === 0) return -1;
    if (a.chapNum !== b.chapNum) return b.chapNum - a.chapNum;

    return compareChapterGroups(a, b);
  });

  return chapters.map((chapter, index) => ({
    ...chapter,
    sortingIndex: chapters.length - index,
  }));
}

// Genre-locked sections carry a known rating; mirror parseMangaDetails so discover
// badges match the detail view. Adult/Smut/Yaoi -> Adult, Ecchi -> Mature.
export function contentRatingForGenres(genreTitles: string[]): ContentRating {
  const lower = genreTitles.map((title) => title.trim().toLowerCase());
  if (lower.some((title) => title === "adult" || title === "smut" || title === "yaoi")) {
    return ContentRating.ADULT;
  }
  if (lower.some((title) => title === "ecchi")) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
}

// Genres hidden via settings (Content Type "Manga" also hides Webtoons).
function settingsExcludedGenres(): string[] {
  const excluded = getHiddenGenreIds().map((id) => getGenreTitle(id));
  if (getContentType() === "manga") excluded.push("Webtoons");
  return excluded;
}

// /list/latest has no `e=` support, so filter New Chapters by each row's parsed
// genres. "Manhwa only" keeps only confirmed webtoons; hidden genres drop rows we
// can identify.
export function filterNewChapters<T extends { genres?: string[] }>(items: T[]): T[] {
  const hidden = new Set(settingsExcludedGenres().map((genre) => genre.toLowerCase()));
  const webtoonsOnly = getContentType() === "webtoons";
  if (hidden.size === 0 && !webtoonsOnly) return items;

  return items.filter((item) => {
    const genres = (item.genres ?? []).map((genre) => genre.trim().toLowerCase());
    if (genres.some((genre) => hidden.has(genre))) return false;
    if (webtoonsOnly && !genres.includes("webtoons")) return false;
    return true;
  });
}

// Build a /genre/ browse URL, folding in the Hide-Genres / Content-Type settings.
// mangago matches genres by display title, comma-joined in the path for includes
// and in `e` for excludes. `statuses` are the selected f/o ids; both-or-none means
// "all", so f/o are only emitted when the user narrowed to a single status.
function buildGenreBrowseUrl(
  includedTitles: string[],
  excludedTitles: string[],
  page: number,
  sortby: string,
  statuses?: string[],
): string {
  const included = [...includedTitles];
  if (getContentType() === "webtoons" && !included.includes("Webtoons")) included.push("Webtoons");

  // A genre can't be both included and excluded (e.g. a manhwa Top + "Manga only").
  const excluded = [...new Set([...excludedTitles, ...settingsExcludedGenres()])].filter(
    (genre) => !included.includes(genre),
  );

  // setQueryItem encodes the `e` commas as %2C, which mangago accepts identically.
  const url = new URL(DOMAIN)
    .addPathComponent("genre")
    .addPathComponent(included.length > 0 ? included.map(encodeURIComponent).join(",") : "all")
    .addPathComponent(String(page));

  if (excluded.length > 0) url.setQueryItem("e", excluded.join(","));
  if (statuses?.length === 1) {
    url.setQueryItem("f", statuses.includes("f") ? "1" : "0");
    url.setQueryItem("o", statuses.includes("o") ? "1" : "0");
  }
  if (sortby) url.setQueryItem("sortby", sortby);

  return url.toString();
}

export function buildGenreFilterUrl(
  metadata: MangagoSearchMetadata | undefined,
  page: number,
  sortby: string,
): string {
  const genres = metadata?.genres ?? {};
  const titlesInState = (want: "included" | "excluded"): string[] =>
    Object.entries(genres)
      .filter(([, state]) => state === want)
      .map(([id]) => getGenreTitle(id));

  return buildGenreBrowseUrl(
    titlesInState("included"),
    titlesInState("excluded"),
    page,
    sortby,
    metadata?.statuses,
  );
}

export function buildDiscoverUrl(sectionId: string, page: number): string {
  // Update times + genres per row live on /list/latest, not the /genre grid.
  if (sectionId === "new_chapters") {
    return new URL(DOMAIN)
      .addPathComponent("list")
      .addPathComponent("latest")
      .addPathComponent("all")
      .addPathComponent(String(page))
      .toString();
  }

  const isTop = sectionId.startsWith("top_");
  const included: string[] = [];
  if (isTop) {
    // mangago matches a genre by display title, not the underscore slug; ",Webtoons"
    // restricts the top to manhwa/manhua.
    included.push(getGenreTitle(sectionId.slice("top_".length)));
    if (MANHWA_TOP_SECTION_IDS.has(sectionId)) included.push("Webtoons");
  }

  // Popular + genre tops rank by comments; featured + fallback by views.
  const sortby = sectionId === "popular_manga" || isTop ? "comment_count" : "view";

  return buildGenreBrowseUrl(included, [], page, sortby);
}

export function sortingIdToMangagoSort(sortingOption?: SortingOption): string {
  return SORT_OPTIONS.find((option) => option.id === sortingOption?.id)?.value ?? "";
}
