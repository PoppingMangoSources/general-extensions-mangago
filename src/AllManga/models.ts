/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// AllManga (allmanga.to) is backed by the allanime.day GraphQL API. Listings,
// details and chapters are fetched with full query strings (persisted-query
// hashes go stale); pages come from the direct `chapterPages` query so the
// source works on iOS without an Android WebView.

export const DOMAIN = "https://allmanga.to";
export const API_URL = "https://api.allanime.day/api";

// CDN bases for thumbnails and quality-scaled images.
export const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
export const IMAGE_CDN = "https://wp.youtube-anime.com";
export const DEFAULT_IMAGE_SERVER = "https://ytimgf.youtube-anime.com/";

export const LIMIT = 20;

export const IMAGE_QUALITY_KEY = "allmanga-image-quality";
export const SHOW_ADULT_KEY = "allmanga-show-adult";
export const IMAGE_QUALITY_DEFAULT = "original";

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  country?: string[];
  genres?: Record<string, "included" | "excluded">;
};

export type OptionItem = {
  id: string;
  value: string;
};

// --- GraphQL query strings ---

export const POPULAR_QUERY = `query($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int, $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) {
  queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page, allowAdult: $allowAdult, allowUnknown: $allowUnknown) {
    recommendations { anyCard { _id name thumbnail englishName } }
  }
}`;

export const SEARCH_QUERY = `query($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges { _id name thumbnail englishName }
  }
}`;

export const DETAILS_QUERY = `query($id: String!) {
  manga(_id: $id) { _id name thumbnail description authors genres tags status altNames englishName }
}`;

export const CHAPTERS_QUERY = `query($id: String!, $showId: String!) {
  manga(_id: $id) { _id name availableChaptersDetail }
  episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) { episodeIdNum notes uploadDates }
}`;

// `pictureUrls` is an opaque scalar array (the API rejects a subfield
// selection on it), and this query expects the manga translation-type enum.
export const PAGES_QUERY = `query($mangaId: String!, $translationType: VaildTranslationTypeMangaEnumType!, $chapterString: String!) {
  chapterPages(mangaId: $mangaId, translationType: $translationType, chapterString: $chapterString) {
    edges { pictureUrlHead pictureUrls }
  }
}`;

// --- API response DTOs (subset of the fields this extension uses) ---

export interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export interface MangaCard {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
}

export interface PopularData {
  queryPopular: {
    recommendations: { anyCard?: MangaCard | null }[];
  };
}

export interface SearchData {
  mangas: { edges: MangaCard[] };
}

export interface MangaDetail {
  _id: string;
  name: string;
  thumbnail?: string | null;
  description?: string | null;
  authors?: string[] | null;
  genres?: string[] | null;
  tags?: string[] | null;
  status?: string | null;
  altNames?: string[] | null;
  englishName?: string | null;
}

export interface DetailsData {
  manga: MangaDetail;
}

export interface AvailableChaptersDetail {
  sub?: string[];
}

export interface EpisodeInfo {
  episodeIdNum: number | string;
  notes?: string | null;
  uploadDates?: { sub?: string | null } | null;
}

export interface ChaptersData {
  manga: {
    _id: string;
    name: string;
    availableChaptersDetail?: AvailableChaptersDetail | null;
  };
  episodeInfos?: EpisodeInfo[] | null;
}

// `pictureUrls` elements come back either as a bare URL string or as an object
// with a `url` field, depending on the entry.
export type PictureUrl = string | { url?: string | null };

export interface ChapterPageEdge {
  pictureUrlHead?: string | null;
  pictureUrls?: PictureUrl[] | null;
}

export interface PagesData {
  chapterPages?: { edges: ChapterPageEdge[] } | null;
}

// --- Static filter option sets ---

export const SORT_OPTIONS: OptionItem[] = [
  { id: "", value: "Update" },
  { id: "Name_ASC", value: "Name Ascending" },
  { id: "Name_DESC", value: "Name Descending" },
];

export const COUNTRY_OPTIONS: OptionItem[] = [
  { id: "ALL", value: "All" },
  { id: "JP", value: "Japan" },
  { id: "CN", value: "China" },
  { id: "KR", value: "Korea" },
];

export const GENRE_OPTIONS: string[] = [
  "4 Koma",
  "Action",
  "Adult",
  "Adventure",
  "Cars",
  "Comedy",
  "Cooking",
  "Crossdressing",
  "Dementia",
  "Demons",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Gender Bender",
  "Gyaru",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Kids",
  "Loli",
  "Magic",
  "Manhua",
  "Manhwa",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Medical",
  "Military",
  "Monster Girls",
  "Music",
  "Mystery",
  "One Shot",
  "Parody",
  "Police",
  "Post Apocalyptic",
  "Psychological",
  "Reincarnation",
  "Reverse Harem",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shota",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Space",
  "Sports",
  "Super Power",
  "Supernatural",
  "Suspense",
  "Thriller",
  "Tragedy",
  "Unknown",
  "Vampire",
  "Webtoons",
  "Yaoi",
  "Youkai",
  "Yuri",
  "Zombies",
];

// Paperback tag IDs may not contain spaces, but the API filters on the genre's
// display name (e.g. "4 Koma"). Map a safe id back to the API name.
export function genreId(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_");
}

export const GENRE_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  GENRE_OPTIONS.map((name) => [genreId(name), name]),
);
