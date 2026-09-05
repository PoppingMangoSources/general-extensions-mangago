/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  type DiscoverSection,
  type JSONObject,
  type SortingOption,
  type Tag,
} from "@paperback/types";

export const MIRRORS: Tag[] = [
  { id: "https://xcomic.me", title: "xcomic.me" },
  { id: "https://xcomic.net", title: "xcomic.net" },
  { id: "https://yona.to", title: "yona.to" },
  { id: "https://comik.to", title: "comik.to" },
];
export const DOMAIN = MIRRORS[0].id;
export const PAGE_SIZE = 48;
// Upper bound on latest-upload pages walked when filtering empties a page.
export const MAX_LATEST_REQUESTS = 10;
export const CHAPTER_PAGE_SIZE = 1000;
export const RECENTLY_ADDED_SIZE = 50;

export const COMIC_BROWSE_PAGER_QUERY = `
query get_comic_browse_pager($select: Comic_Browse_Select) {
  get_comic_browse_pager(select: $select) {
    next
  }
}
`;

export const COMIC_BROWSE_ITEMS_QUERY = `
query get_comic_browse_items($select: Comic_Browse_Select) {
  get_comic_browse_items(select: $select) {
    data {
      id name altNames
      originalLanguage translatedLanguage
      type contentRating genres tags
      summary { html }
      urlPath urlCover
      sfw_result score_val follows reviews comments_total chaps_normal
      chapterNodes_last(amount: 1) {
        data {
          id serial chaNum urlPath
          dateCreate dateModify datePublic
        }
      }
    }
  }
}
`;

export const TITLE_BROWSE_PAGER_QUERY = `
query get_title_browse_pager($select: Title_Browse_Select) {
  get_title_browse_pager(select: $select) {
    next
  }
}
`;

export const TITLE_BROWSE_ITEMS_QUERY = `
query get_title_browse_items($select: Title_Browse_Select) {
  get_title_browse_items(select: $select) {
    data {
      id
      name: title
      altNames: alt_titles
      nativeTitle: native_title
      romanizedTitle: romanized_title
      originalLanguage: original_language
      contentRating: content_rating_id
      type: type_id
      genres: genre_ids
      tags: format_ids
      description
      urlCover: cover_local_url
      remoteCoverUrl: cover_url
      urlPath
      totalChapters: total_chapters
      follows: total_follows
      reviews: total_reviews
      comments_total: total_comments
      translatedLanguages: translated_languages
      score_val: vote_val
    }
    comicNodes {
      data {
        id name translatedLanguage chaps_normal
      }
    }
  }
}
`;

export const LATEST_UPLOADS_QUERY = `
query get_comic_latestUploads($select: Comic_LatestUploads_Select) {
  get_comic_latestUploads(select: $select) {
    before
    items {
      comic {
        data {
          id name urlPath urlCover
          originalLanguage translatedLanguage
          type contentRating genres tags sfw_result
        }
      }
      chapters(amount: 1) {
        data {
          id serial chaNum urlPath
          dateCreate dateModify datePublic
        }
      }
    }
  }
}
`;

export const RECENTLY_ADDED_QUERY = `
query get_comic_recentlyAdded($select: Comic_RecentlyAdded_Select) {
  get_comic_recentlyAdded(select: $select) {
    before
    items {
      data {
        id name urlPath urlCover
        originalLanguage translatedLanguage
        type contentRating genres tags sfw_result
      }
    }
  }
}
`;

export const COMIC_QUERY = `
query get_comicNode($id: ID!) {
  get_comicNode(id: $id) {
    data {
      id name altNames
      originalLanguage translatedLanguage
      originalStatus originalPubFrom { y m d }
      originalPubTill { y m d }
      originalPubZone uploadStatus
      type demographics contentRating genres tags
      authorNodes { data { name } }
      artistNodes { data { name } }
      tagNodes { data { name } }
      publisherNodes { data { name } }
      summary { html }
      urlPath urlCover
      sfw_result score_val follows reviews comments_total chaps_normal
    }
  }
}
`;

export const CHAPTERS_QUERY = `
query get_comic_chapterList_uniqList($select: Select_Comic_ChapterList_UniqList) {
  get_comic_chapterList_uniqList(select: $select) {
    paging { pages }
    items {
      data {
        id dbStatus serial chaNum
        dname title urlPath
        dateCreate dateModify datePublic
        srcName
        profileNodes { data { name } }
        userNode { data { name } }
        groupNodes { data { name } }
      }
    }
  }
}
`;

export const CHAPTER_PAGES_QUERY = `
query get_chapterNode($id: ID!) {
  get_chapterNode(id: $id) {
    data { imageUrls }
  }
}
`;

export const SECTIONS = {
  TOP_RATED: "top-rated",
  MOST_VIEWS: "most-views",
  MOST_FOLLOWS: "most-follows",
  MOST_REVIEWS: "most-reviews",
  LATEST_UPLOADS: "latest-uploads",
  RECENTLY_ADDED: "recently-added",
  MOST_COMMENTS: "most-comments",
  MOST_CHAPTERS: "most-chapters",
  GENRES: "genres",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const DISCOVER_SECTIONS: Record<SectionId, DiscoverSection> = {
  [SECTIONS.TOP_RATED]: {
    id: SECTIONS.TOP_RATED,
    title: "Top Rated",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.MOST_VIEWS]: {
    id: SECTIONS.MOST_VIEWS,
    title: "Most Views",
    type: DiscoverSectionType.genres,
  },
  [SECTIONS.MOST_FOLLOWS]: {
    id: SECTIONS.MOST_FOLLOWS,
    title: "Most Followed",
    type: DiscoverSectionType.prominentCarousel,
  },
  [SECTIONS.MOST_REVIEWS]: {
    id: SECTIONS.MOST_REVIEWS,
    title: "Most Reviewed",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.LATEST_UPLOADS]: {
    id: SECTIONS.LATEST_UPLOADS,
    title: "Latest Uploads",
    type: DiscoverSectionType.chapterUpdates,
  },
  [SECTIONS.RECENTLY_ADDED]: {
    id: SECTIONS.RECENTLY_ADDED,
    title: "Recently Added",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.MOST_COMMENTS]: {
    id: SECTIONS.MOST_COMMENTS,
    title: "Most Commented",
    type: DiscoverSectionType.featured,
  },
  [SECTIONS.MOST_CHAPTERS]: {
    id: SECTIONS.MOST_CHAPTERS,
    title: "Most Chapters",
    type: DiscoverSectionType.simpleCarousel,
  },
  [SECTIONS.GENRES]: {
    id: SECTIONS.GENRES,
    title: "Genres",
    type: DiscoverSectionType.genres,
  },
};

export const SECTION_IDS = Object.values(SECTIONS);
export const SECTION_OPTIONS = Object.values(DISCOVER_SECTIONS).map(({ id, title }) => ({
  id,
  title,
}));

export const STATE_KEYS = {
  ACTIVE_BASE_URL: "xcomic_active_base_url",
  BASE_URL: "xcomic_base_url",
  CONTENT_RATINGS: "xcomic_content_ratings",
  CONTENT_TYPES: "xcomic_content_types",
  EXCLUDED_GENRES: "xcomic_excluded_genres",
  EXCLUDED_FORMATS: "xcomic_excluded_formats",
  ORIGINAL_LANGUAGES: "xcomic_original_languages",
  TRANSLATED_LANGUAGES: "xcomic_languages",
  VISIBLE_SECTIONS_VERSION: "xcomic_visible_sections_version",
  VISIBLE_SECTIONS: "xcomic_visible_sections",
} as const;

export const VISIBLE_SECTIONS_VERSION = 2;

export type ContentPreferenceRating = "safe" | "suggestive" | "erotica" | "pornographic";
export const CONTENT_RATING_GENRES = {
  suggestive: ["ecchi", "mature", "yaoi", "yuri"],
  erotica: ["adult", "erotica", "smut"],
  pornographic: ["hentai", "pornographic"],
} as const satisfies Record<Exclude<ContentPreferenceRating, "safe">, readonly string[]>;
export type SeriesType = "manga" | "manhua" | "manhwa" | "novel" | "oel" | "other";
export const LEGACY_TYPE_MAP: Record<string, SeriesType> = {
  artbook: "other",
  cartoon: "oel",
  imageset: "other",
  western: "oel",
};
export const LEGACY_FORMAT_MAP: Record<string, string> = { long_strip: "longstrip" };
export type GenreMode = "and" | "or";
export type TriState = Record<string, "included" | "excluded">;

export interface XComicPreferences {
  contentRatings: ContentPreferenceRating[];
  excludedFormats: string[];
  excludedGenres: string[];
  originalLanguages: string[];
  translatedLanguages: string[];
  types: SeriesType[];
}

export type RankedMetric = "top" | "follows" | "reviews" | "comments" | "chapters";

export const DEFAULT_CONTENT_RATINGS: ContentPreferenceRating[] = [
  "safe",
  "suggestive",
  "erotica",
  "pornographic",
];
export const DEFAULT_CONTENT_TYPES: SeriesType[] = [
  "manhwa",
  "manga",
  "manhua",
  "other",
  "oel",
  "novel",
];
export const DEFAULT_LANGUAGES: string[] = ["en"];

export const CONTENT_RATING_OPTIONS: Array<{ id: ContentPreferenceRating; title: string }> = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

// The SDK gives MangaInfo no language field, so the chapter language rides in additionalInfo.
// Both the writer and the reader use this constant so the two can never drift apart.
export const TRANSLATED_LANGUAGE_KEY = "Translated Language";

// Only ids whose display name differs from title-casing the id itself.
export const TAG_TITLE_OVERRIDES: Record<string, string> = {
  silver_golden: "Silver & Golden",
  non_human: "Non-human",
};

export const MODE_OPTIONS: Array<{ id: GenreMode; title: string }> = [
  { id: "and", title: "AND" },
  { id: "or", title: "OR" },
];

export const CHAPTER_COUNT_OPTIONS: Tag[] = [
  { id: "", title: "Any" },
  { id: "0", title: "0" },
  { id: "1", title: "1+" },
  { id: "10", title: "10+" },
  { id: "20", title: "20+" },
  { id: "30", title: "30+" },
  { id: "40", title: "40+" },
  { id: "50", title: "50+" },
  { id: "60", title: "60+" },
  { id: "70", title: "70+" },
  { id: "80", title: "80+" },
  { id: "90", title: "90+" },
  { id: "100", title: "100+" },
  { id: "200", title: "200+" },
  { id: "300", title: "300+" },
  { id: "1-9", title: "1–9" },
  { id: "10-19", title: "10–19" },
  { id: "20-29", title: "20–29" },
  { id: "30-39", title: "30–39" },
  { id: "40-49", title: "40–49" },
  { id: "50-59", title: "50–59" },
  { id: "60-69", title: "60–69" },
  { id: "70-79", title: "70–79" },
  { id: "80-89", title: "80–89" },
  { id: "90-99", title: "90–99" },
  { id: "100-199", title: "100–199" },
  { id: "200-299", title: "200–299" },
];

export interface FilterOptions {
  contentRatings: Tag[];
  demographics: Tag[];
  formats: Tag[];
  genres: Tag[];
  statuses: Tag[];
  types: Tag[];
}

// Complete current picker; "Other" (_t) remains last.
export const LANGUAGE_OPTIONS: Tag[] = [
  { id: "en", title: "English" },
  { id: "ab", title: "Abkhazian" },
  { id: "af", title: "Afrikaans" },
  { id: "sq", title: "Albanian" },
  { id: "ar", title: "Arabic" },
  { id: "hy", title: "Armenian" },
  { id: "az", title: "Azerbaijani" },
  { id: "eu", title: "Basque" },
  { id: "be", title: "Belarusian" },
  { id: "bn", title: "Bengali" },
  { id: "bs", title: "Bosnian" },
  { id: "bg", title: "Bulgarian" },
  { id: "my", title: "Burmese" },
  { id: "km", title: "Cambodian" },
  { id: "ca", title: "Catalan" },
  { id: "ceb", title: "Cebuano" },
  { id: "zh", title: "Chinese" },
  { id: "zh_hk", title: "Chinese (T)" },
  { id: "cv", title: "Chuvash" },
  { id: "hr", title: "Croatian" },
  { id: "cs", title: "Czech" },
  { id: "da", title: "Danish" },
  { id: "nl", title: "Dutch" },
  { id: "eo", title: "Esperanto" },
  { id: "et", title: "Estonian" },
  { id: "fil", title: "Filipino" },
  { id: "fi", title: "Finnish" },
  { id: "fr", title: "French" },
  { id: "gl", title: "Galician" },
  { id: "ka", title: "Georgian" },
  { id: "de", title: "German" },
  { id: "el", title: "Greek" },
  { id: "gn", title: "Guarani" },
  { id: "gu", title: "Gujarati" },
  { id: "ht", title: "Haitian Creole" },
  { id: "he", title: "Hebrew" },
  { id: "hi", title: "Hindi" },
  { id: "hu", title: "Hungarian" },
  { id: "is", title: "Icelandic" },
  { id: "ig", title: "Igbo" },
  { id: "id", title: "Indonesian" },
  { id: "ga", title: "Irish" },
  { id: "it", title: "Italian" },
  { id: "ja", title: "Japanese" },
  { id: "jv", title: "Javanese" },
  { id: "kk", title: "Kazakh" },
  { id: "ko", title: "Korean" },
  { id: "ku", title: "Kurdish" },
  { id: "ky", title: "Kyrgyz" },
  { id: "lo", title: "Laothian" },
  { id: "la", title: "Latin" },
  { id: "lv", title: "Latvian" },
  { id: "lt", title: "Lithuanian" },
  { id: "mg", title: "Malagasy" },
  { id: "ms", title: "Malay" },
  { id: "ml", title: "Malayalam" },
  { id: "mt", title: "Maltese" },
  { id: "mi", title: "Maori" },
  { id: "mr", title: "Marathi" },
  { id: "mo", title: "Moldavian" },
  { id: "mn", title: "Mongolian" },
  { id: "ne", title: "Nepali" },
  { id: "no", title: "Norwegian" },
  { id: "ny", title: "Nyanja" },
  { id: "ps", title: "Pashto" },
  { id: "fa", title: "Persian" },
  { id: "pl", title: "Polish" },
  { id: "pt", title: "Portuguese" },
  { id: "pt_br", title: "Portuguese (BR)" },
  { id: "ro", title: "Romanian" },
  { id: "ru", title: "Russian" },
  { id: "sr", title: "Serbian" },
  { id: "sh", title: "Serbo-Croatian" },
  { id: "st", title: "Sesotho" },
  { id: "si", title: "Sinhalese" },
  { id: "sk", title: "Slovak" },
  { id: "sl", title: "Slovenian" },
  { id: "so", title: "Somali" },
  { id: "es", title: "Spanish" },
  { id: "es_419", title: "Spanish (LA)" },
  { id: "ss", title: "Swati" },
  { id: "sv", title: "Swedish" },
  { id: "ta", title: "Tamil" },
  { id: "te", title: "Telugu" },
  { id: "th", title: "Thai" },
  { id: "ti", title: "Tigrinya" },
  { id: "to", title: "Tonga" },
  { id: "tr", title: "Turkish" },
  { id: "tk", title: "Turkmen" },
  { id: "uk", title: "Ukrainian" },
  { id: "ur", title: "Urdu" },
  { id: "uz", title: "Uzbek" },
  { id: "vi", title: "Vietnamese" },
  { id: "yo", title: "Yoruba" },
  { id: "zu", title: "Zulu" },
  { id: "_t", title: "Other" },
];

export const MOST_VIEWS_OPTIONS = [
  { id: "views_d000", label: "Most Views (Total)", chipLabel: "Total" },
  { id: "views_d360", label: "Most Views (360 days)", chipLabel: "360 Days" },
  { id: "views_d180", label: "Most Views (180 days)", chipLabel: "180 Days" },
  { id: "views_d090", label: "Most Views (90 days)", chipLabel: "90 Days" },
  { id: "views_d030", label: "Most Views (30 days)", chipLabel: "30 Days" },
  { id: "views_d007", label: "Most Views (7 days)", chipLabel: "7 Days" },
  { id: "views_h024", label: "Most Views (24 hours)", chipLabel: "24 Hours" },
  { id: "views_h012", label: "Most Views (12 hours)", chipLabel: "12 Hours" },
  { id: "views_h006", label: "Most Views (6 hours)", chipLabel: "6 Hours" },
  { id: "views_h001", label: "Most Views (1 hour)", chipLabel: "1 Hour" },
] as const satisfies Array<SortingOption & { chipLabel: string }>;

export type MostViewsSort = (typeof MOST_VIEWS_OPTIONS)[number]["id"];

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "field_score", label: "Rating Score" },
  { id: "field_update", label: "Latest Update" },
  { id: "field_create", label: "Recently Added" },
  { id: "field_name_asc", label: "Name A-Z" },
  { id: "field_name_desc", label: "Name Z-A" },
  { id: "field_chapter", label: "Most Chapters" },
  { id: "field_follow", label: "Most Follows" },
  { id: "field_review", label: "Most Reviews" },
  { id: "field_comment", label: "Most Comments" },
  ...MOST_VIEWS_OPTIONS,
];

export interface PageMetadata extends JSONObject {
  before?: number;
  page?: number;
}

export interface SearchMetadata extends JSONObject {
  chapCount?: string;
  contentRatings?: ContentPreferenceRating[];
  demographics?: string[];
  excGenresMode?: GenreMode;
  formats?: TriState;
  genres?: TriState;
  incGenresMode?: GenreMode;
  originalLanguages?: string[];
  originalStatus?: string[];
  discoverSort?: MostViewsSort;
  translatedLanguages?: string[];
  types?: SeriesType[];
  year?: string;
}

export interface BrowseSelect {
  where: "browse";
  page: number;
  size: number;
  sortby: string;
  word: string;
  incOLangs: string[];
  incTLangs: string[];
  incGenres: string[];
  excGenres: string[];
  incGenresMode: GenreMode | null;
  excGenresMode: GenreMode | null;
  incTypes: SeriesType[];
  incDemographics: string[];
  incContentRatings: ContentPreferenceRating[];
  releaseYearMin: number | null;
  releaseYearMax: number | null;
  origStatus: string | null;
  chapCount: string | null;
  ignoreGlobalULangs: boolean;
  ignoreGlobalGenres: boolean;
  ignoreGlobalBlocks: boolean;
}

interface DateYmd {
  y?: number | null;
  m?: number | null;
  d?: number | null;
}

interface NamedNode {
  data?: {
    name?: string;
  } | null;
}

export interface ChapterData {
  id: string;
  dbStatus?: string | null;
  serial?: number | null;
  chaNum?: number | null;
  dname?: string | null;
  title?: string | null;
  urlPath?: string | null;
  dateCreate?: number | null;
  dateModify?: number | null;
  datePublic?: number | null;
  srcName?: string | null;
  profileNodes?: Array<NamedNode | null> | null;
  userNode?: NamedNode | null;
  groupNodes?: Array<NamedNode | null> | null;
}

export interface ChapterNode {
  data: ChapterData;
}

interface LatestUploadItem {
  comic?: ComicNode | null;
  chapters?: ChapterNode[] | null;
}

export interface LatestUploadsResult {
  before?: number | null;
  items?: LatestUploadItem[] | null;
}

export interface ComicData {
  id: string;
  name: string;
  altNames?: string[] | null;
  nativeTitle?: string | null;
  romanizedTitle?: string | null;
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
  translatedLanguages?: string[] | null;
  originalStatus?: string | null;
  originalPubFrom?: DateYmd | null;
  originalPubTill?: DateYmd | null;
  originalPubZone?: string | null;
  uploadStatus?: string | null;
  type?: string | null;
  demographics?: string[] | null;
  contentRating?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
  authorNodes?: NamedNode[] | null;
  artistNodes?: NamedNode[] | null;
  tagNodes?: NamedNode[] | null;
  publisherNodes?: NamedNode[] | null;
  summary?: { html?: string | null } | null;
  description?: string | null;
  urlPath?: string | null;
  urlCover?: string | null;
  remoteCoverUrl?: string | null;
  sfw_result?: boolean | null;
  score_val?: number | null;
  follows?: number | null;
  reviews?: number | null;
  comments_total?: number | null;
  chaps_normal?: number | null;
  totalChapters?: number | null;
  chapterNodes_last?: ChapterNode[] | null;
}

export interface ComicNode {
  data: ComicData;
  comicNodes?: ComicNode[] | null;
}

export interface ComicBrowseItemsResponse {
  get_comic_browse_items?: ComicNode[] | null;
}

export interface ComicBrowsePagerResponse {
  get_comic_browse_pager?: {
    next?: number | null;
  } | null;
}

export type ComicBrowseResponse = ComicBrowseItemsResponse & ComicBrowsePagerResponse;

export interface TitleBrowseItemsResponse {
  get_title_browse_items?: ComicNode[] | null;
}

export interface TitleBrowsePagerResponse {
  get_title_browse_pager?: {
    next?: number | null;
  } | null;
}

export type TitleBrowseResponse = TitleBrowseItemsResponse & TitleBrowsePagerResponse;

export interface LatestUploadsResponse {
  get_comic_latestUploads?: LatestUploadsResult | null;
}

export interface RecentlyAddedResponse {
  get_comic_recentlyAdded?: {
    items?: ComicNode[] | null;
  } | null;
}

export interface ComicNodeResponse {
  get_comicNode?: ComicNode | null;
}

interface ChapterListResult {
  paging?: { pages?: number | null } | null;
  items?: ChapterNode[] | null;
}

export interface ChapterListResponse {
  get_comic_chapterList_uniqList?: ChapterListResult | null;
}

export interface ChapterPagesResponse {
  get_chapterNode?: {
    data?: {
      imageUrls?: string[] | null;
    } | null;
  } | null;
}

export interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string }> | null;
}
