/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DEFAULT_DOMAIN = "https://kingofshojo.com";
export const MANGA_DIR = "manga";
export const FEATURED_LIMIT = 10;

export const CARD_SELECTOR = ".utao .uta .imgu, .listupd .bs .bsx, .listo .bs .bsx, .bsx";
export const NEXT_PAGE_SELECTOR = "div.pagination .next, div.hpage .r, a:has(img[alt=Next])";

export const DETAILS_SCOPE = "div.bigcontent, div.animefull, div.main-info, div.postbody";
export const TITLE_SELECTOR = "h1.entry-title, .ts-breadcrumb li:last-child span";
export const THUMB_SELECTOR = ".infomanga > div[itemprop=image] img, .thumb img";
export const DESC_SELECTOR = ".desc, .entry-content[itemprop=description]";
export const ALT_NAME_SELECTOR = ".alternative, .wd-full:contains(alt) span, .alter, .seriestualt";
export const GENRE_SELECTOR = "div.gnr a, .mgen a, .seriestugenre a";
export const AUTHOR_SELECTOR =
  ".infotable tr:contains(Author) td:last-child, .tsinfo .imptdt:contains(Author) i, .fmed b:contains(Author)+span";
export const ARTIST_SELECTOR =
  ".infotable tr:contains(Artist) td:last-child, .tsinfo .imptdt:contains(Artist) i, .fmed b:contains(Artist)+span";
export const STATUS_SELECTOR =
  ".infotable tr:contains(Status) td:last-child, .tsinfo .imptdt:contains(Status) i, .fmed b:contains(Status)+span";

export const CHAPTER_SELECTOR =
  "div.bxcl li, div.cl li, #chapterlist li, ul li:has(div.chbox):has(div.eph-num)";
export const CHAPTER_NAME_SELECTOR = ".lch a, .chapternum";
export const CHAPTER_DATE_SELECTOR = ".chapterdate";
export const PAGE_SELECTOR = "div#readerarea img";
export const IMAGE_LIST_REGEX = /"images"\s*:\s*(\[.*?\])/s;

export const GENRE_FILTER_SELECTOR = "ul.genrez li";

export const ADULT_GENRE_NAMES: ReadonlySet<string> = new Set([
  "adult",
  "adult content",
  "smut",
  "hentai",
  "erotica",
  "pornographic",
  "ecchi",
  "mature",
  "18+",
  "nsfw",
]);

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  author?: string;
  year?: string;
  status?: string[];
  type?: string[];
  genres?: Record<string, "included" | "excluded">;
  popularRange?: string;
};

export type OptionItem = {
  id: string;
  value: string;
};

export type MangaCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
  subtitle?: string;
  rating?: string;
  isAdult?: boolean;
};

export const POPULAR_RANGE_OPTIONS: OptionItem[] = [
  { id: "wpop-weekly", value: "Weekly" },
  { id: "wpop-monthly", value: "Monthly" },
  { id: "wpop-alltime", value: "All" },
];

export type LatestCard = MangaCard & {
  chapterId?: string;
  chapterName?: string;
  publishDate?: Date;
};

export const STATUS_OPTIONS: OptionItem[] = [
  { id: "", value: "All" },
  { id: "ongoing", value: "Ongoing" },
  { id: "completed", value: "Completed" },
  { id: "hiatus", value: "Hiatus" },
  { id: "dropped", value: "Dropped" },
];

export const TYPE_OPTIONS: OptionItem[] = [
  { id: "", value: "All" },
  { id: "Manga", value: "Manga" },
  { id: "Manhwa", value: "Manhwa" },
  { id: "Manhua", value: "Manhua" },
  { id: "Comic", value: "Comic" },
];

export const ORDER_OPTIONS: OptionItem[] = [
  { id: "", value: "Default" },
  { id: "title", value: "A-Z" },
  { id: "titlereverse", value: "Z-A" },
  { id: "update", value: "Latest Update" },
  { id: "latest", value: "Latest Added" },
  { id: "popular", value: "Popular" },
];

export const SORTING_OPTIONS = ORDER_OPTIONS.map((option) => ({
  id: option.id,
  label: option.value,
}));
