/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject, SortingOption, Tag } from "@paperback/types";

export const DOMAIN = "https://xcomic.me";
export const API_URL = `${DOMAIN}/query/`;
export const PAGE_SIZE = 36;
export const CHAPTER_PAGE_SIZE = 100;

export const SECTIONS = {
  TOP_RATED: "top-rated",
  LATEST_UPLOADS: "latest-uploads",
  RECENTLY_ADDED: "recently-added",
  MOST_CHAPTERS: "most-chapters",
  GENRES: "genres",
} as const;

export type SectionId = (typeof SECTIONS)[keyof typeof SECTIONS];

export const SECTION_OPTIONS: Array<{ id: SectionId; title: string }> = [
  { id: SECTIONS.TOP_RATED, title: "Top Rated" },
  { id: SECTIONS.LATEST_UPLOADS, title: "Latest Uploads" },
  { id: SECTIONS.RECENTLY_ADDED, title: "Recently Added" },
  { id: SECTIONS.MOST_CHAPTERS, title: "Most Chapters" },
  { id: SECTIONS.GENRES, title: "Genres" },
];

export const STATE_KEYS = {
  CONTENT_RATINGS: "xcomic_content_ratings",
  CONTENT_TYPES: "xcomic_content_types",
  EXCLUDED_GENRES: "xcomic_excluded_genres",
  EXCLUDED_TAGS: "xcomic_excluded_tags",
  SECTION_ORDER: "xcomic_section_order",
  VISIBLE_SECTIONS: "xcomic_visible_sections",
} as const;

export type ContentPreferenceRating = "safe" | "suggestive" | "erotica" | "pornographic";
export type SeriesType =
  | "artbook"
  | "cartoon"
  | "imageset"
  | "manga"
  | "manhua"
  | "manhwa"
  | "western";
export type Demographic =
  | "shounen"
  | "shoujo"
  | "seinen"
  | "josei"
  | "kodomo"
  | "silver_golden"
  | "non_human";
export type WorkStatus = "pending" | "ongoing" | "completed" | "hiatus" | "cancelled";
export type GenreMode = "and" | "or";
export type TriState = Record<string, "included" | "excluded">;

export interface XComicPreferences {
  contentRatings: ContentPreferenceRating[];
  excludedGenres: string[];
  excludedTags: string[];
  types: SeriesType[];
}

export const DEFAULT_CONTENT_RATINGS: ContentPreferenceRating[] = ["safe", "suggestive"];
export const DEFAULT_CONTENT_TYPES: SeriesType[] = ["manga", "manhwa", "manhua"];

export const CONTENT_RATING_OPTIONS: Array<{ id: ContentPreferenceRating; title: string }> = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const TYPE_OPTIONS: Array<{ id: SeriesType; title: string }> = [
  { id: "artbook", title: "Artbook" },
  { id: "cartoon", title: "Cartoon" },
  { id: "imageset", title: "Imageset" },
  { id: "manga", title: "Manga" },
  { id: "manhua", title: "Manhua" },
  { id: "manhwa", title: "Manhwa" },
  { id: "western", title: "Western" },
];

export const DEMOGRAPHIC_OPTIONS: Array<{ id: Demographic; title: string }> = [
  { id: "shounen", title: "Shounen" },
  { id: "shoujo", title: "Shoujo" },
  { id: "seinen", title: "Seinen" },
  { id: "josei", title: "Josei" },
  { id: "kodomo", title: "Kodomo" },
  { id: "silver_golden", title: "Silver & Golden" },
  { id: "non_human", title: "Non-human" },
];

export const STATUS_OPTIONS: Array<{ id: WorkStatus; title: string }> = [
  { id: "pending", title: "Pending" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
];

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
  { id: "100", title: "100+" },
  { id: "200", title: "200+" },
  { id: "300", title: "300+" },
  { id: "1-9", title: "1–9" },
  { id: "10-19", title: "10–19" },
  { id: "20-29", title: "20–29" },
  { id: "30-39", title: "30–39" },
  { id: "40-49", title: "40–49" },
  { id: "50-59", title: "50–59" },
  { id: "100-199", title: "100–199" },
  { id: "200-299", title: "200–299" },
];

export const FORMAT_OPTIONS: Tag[] = [
  { id: "4_koma", title: "4 Koma" },
  { id: "adaptation", title: "Adaptation" },
  { id: "anthology", title: "Anthology" },
  { id: "award_winning", title: "Award Winning" },
  { id: "doujinshi", title: "Doujinshi" },
  { id: "fan_colored", title: "Fan Colored" },
  { id: "full_color", title: "Full Color" },
  { id: "long_strip", title: "Long Strip" },
  { id: "official_colored", title: "Official Colored" },
  { id: "oneshot", title: "Oneshot" },
  { id: "web_comic", title: "Web Comic" },
  { id: "webtoon", title: "Webtoon" },
];

export const GENRE_OPTIONS: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "age_gap", title: "Age Gap" },
  { id: "aliens", title: "Aliens" },
  { id: "animals", title: "Animals" },
  { id: "art_by_ai", title: "Art-by-AI" },
  { id: "bara", title: "Bara" },
  { id: "beasts", title: "Beasts" },
  { id: "blackmail", title: "Blackmail" },
  { id: "bodyswap", title: "Bodyswap" },
  { id: "boys", title: "Boys" },
  { id: "boys_love", title: "Boys Love" },
  { id: "brocon_siscon", title: "Brocon Siscon" },
  { id: "cars", title: "Cars" },
  { id: "cheating_infidelity", title: "Cheating/Infidelity" },
  { id: "childhood_friends", title: "Childhood Friends" },
  { id: "college_life", title: "College Life" },
  { id: "comedy", title: "Comedy" },
  { id: "comic", title: "Comic" },
  { id: "contest_winning", title: "Contest Winning" },
  { id: "cooking", title: "Cooking" },
  { id: "crime", title: "Crime" },
  { id: "crossdressing", title: "Crossdressing" },
  { id: "cultivation", title: "Cultivation" },
  { id: "death_game", title: "Death Game" },
  { id: "degeneratemc", title: "Degeneratemc" },
  { id: "delinquents", title: "Delinquents" },
  { id: "dementia", title: "Dementia" },
  { id: "demons", title: "Demons" },
  { id: "drama", title: "Drama" },
  { id: "dungeons", title: "Dungeons" },
  { id: "emperors_daughter", title: "Emperor's Daughter" },
  { id: "family", title: "Family" },
  { id: "fantasy", title: "Fantasy" },
  { id: "female_protagonists", title: "Female Protagonists" },
  { id: "fetish", title: "Fetish" },
  { id: "futa", title: "Futa" },
  { id: "game", title: "Game" },
  { id: "genderswap", title: "Genderswap" },
  { id: "ghosts", title: "Ghosts" },
  { id: "girls", title: "Girls" },
  { id: "girls_love", title: "Girls Love" },
  { id: "gyaru", title: "Gyaru" },
  { id: "harem", title: "Harem" },
  { id: "harlequin", title: "Harlequin" },
  { id: "historical", title: "Historical" },
  { id: "horror", title: "Horror" },
  { id: "incest", title: "Incest" },
  { id: "isekai", title: "Isekai" },
  { id: "kids", title: "Kids" },
  { id: "loli", title: "Loli" },
  { id: "mafia", title: "Mafia" },
  { id: "magic", title: "Magic" },
  { id: "magical_girls", title: "Magical Girls" },
  { id: "mahjong", title: "Mahjong" },
  { id: "male_protagonists", title: "Male Protagonists" },
  { id: "martial_arts", title: "Martial Arts" },
  { id: "master_servant", title: "Master-Servant" },
  { id: "mecha", title: "Mecha" },
  { id: "medical", title: "Medical" },
  { id: "milf", title: "Milf" },
  { id: "military", title: "Military" },
  { id: "monster_girls", title: "Monster Girls" },
  { id: "monsters", title: "Monsters" },
  { id: "music", title: "Music" },
  { id: "mystery", title: "Mystery" },
  { id: "netorare_ntr", title: "Netorare/NTR" },
  { id: "netori", title: "Netori" },
  { id: "ninja", title: "Ninja" },
  { id: "office_workers", title: "Office Workers" },
  { id: "omegaverse", title: "Omegaverse" },
  { id: "parody", title: "Parody" },
  { id: "philosophical", title: "Philosophical" },
  { id: "police", title: "Police" },
  { id: "post_apocalyptic", title: "Post-Apocalyptic" },
  { id: "psychological", title: "Psychological" },
  { id: "regression", title: "Regression" },
  { id: "reincarnation", title: "Reincarnation" },
  { id: "revenge", title: "Revenge" },
  { id: "reverse_harem", title: "Reverse Harem" },
  { id: "reverse_isekai", title: "Reverse Isekai" },
  { id: "romance", title: "Romance" },
  { id: "royal_family", title: "Royal Family" },
  { id: "royalty", title: "Royalty" },
  { id: "samurai", title: "Samurai" },
  { id: "school_life", title: "School Life" },
  { id: "sci_fi", title: "Sci-Fi" },
  { id: "sexual_violence", title: "Sexual Violence" },
  { id: "shota", title: "Shota" },
  { id: "shoujo_ai", title: "Shoujo Ai" },
  { id: "shounen_ai", title: "Shounen Ai" },
  { id: "showbiz", title: "Showbiz" },
  { id: "slice_of_life", title: "Slice of Life" },
  { id: "sm_bdsm_sub_dom", title: "SM/BDSM/SUB-DOM" },
  { id: "space", title: "Space" },
  { id: "sports", title: "Sports" },
  { id: "spy", title: "Spy" },
  { id: "step_family", title: "Step-family" },
  { id: "story_by_ai", title: "Story-by-AI" },
  { id: "super_power", title: "Super Power" },
  { id: "superhero", title: "Superhero" },
  { id: "supernatural", title: "Supernatural" },
  { id: "survival", title: "Survival" },
  { id: "suspense", title: "Suspense" },
  { id: "teacher_student", title: "Teacher-Student" },
  { id: "thriller", title: "Thriller" },
  { id: "time_travel", title: "Time Travel" },
  { id: "tower_climbing", title: "Tower Climbing" },
  { id: "traditional_games", title: "Traditional Games" },
  { id: "tragedy", title: "Tragedy" },
  { id: "transmigration", title: "Transmigration" },
  { id: "vampires", title: "Vampires" },
  { id: "video_games", title: "Video Games" },
  { id: "villainess", title: "Villainess" },
  { id: "virtual_reality", title: "Virtual Reality" },
  { id: "wuxia", title: "Wuxia" },
  { id: "xianxia", title: "Xianxia" },
  { id: "xuanhuan", title: "Xuanhuan" },
  { id: "yakuzas", title: "Yakuzas" },
  { id: "youkai", title: "Youkai" },
  { id: "zombies", title: "Zombies" },
];

export const LANGUAGE_OPTIONS: Tag[] = [
  { id: "en", title: "English" },
  { id: "zh", title: "Chinese" },
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "ar", title: "Arabic" },
  { id: "de", title: "German" },
  { id: "es", title: "Spanish" },
  { id: "es_419", title: "Spanish (Latin America)" },
  { id: "fr", title: "French" },
  { id: "hi", title: "Hindi" },
  { id: "id", title: "Indonesian" },
  { id: "it", title: "Italian" },
  { id: "pl", title: "Polish" },
  { id: "pt", title: "Portuguese" },
  { id: "pt_br", title: "Portuguese (Brazil)" },
  { id: "ru", title: "Russian" },
  { id: "th", title: "Thai" },
  { id: "tr", title: "Turkish" },
  { id: "uk", title: "Ukrainian" },
  { id: "vi", title: "Vietnamese" },
  { id: "zh_hk", title: "Chinese (Cantonese)" },
  { id: "zh_tw", title: "Chinese (Traditional)" },
  { id: "_t", title: "Other" },
];

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "field_score", label: "Rating Score" },
  { id: "field_follow", label: "Most Follows" },
  { id: "field_review", label: "Most Reviews" },
  { id: "field_comment", label: "Most Comments" },
  { id: "field_chapter", label: "Most Chapters" },
  { id: "field_upload", label: "Latest Upload" },
  { id: "field_public", label: "Recently Created" },
  { id: "field_name", label: "Name A-Z" },
  { id: "views_d000", label: "Most Views (Total)" },
  { id: "views_d030", label: "Most Views (30 days)" },
  { id: "views_d007", label: "Most Views (7 days)" },
  { id: "views_h024", label: "Most Views (24 hours)" },
];

export interface PageMetadata extends JSONObject {
  page: number;
}

export interface SearchMetadata extends JSONObject {
  chapCount?: string;
  contentRatings?: ContentPreferenceRating[];
  demographics?: Demographic[];
  excGenresMode?: GenreMode;
  genres?: TriState;
  incGenresMode?: GenreMode;
  originalLanguages?: string[];
  originalStatus?: WorkStatus[];
  tags?: TriState;
  translatedLanguages?: string[];
  types?: SeriesType[];
  uploadStatus?: WorkStatus[];
  year?: string;
}

export interface BrowseSelect {
  where: "browse";
  page: number;
  size: number;
  init: number;
  sortby: string;
  word: string;
  incOLangs: string[];
  incTLangs: string[];
  incGenres: string[];
  excGenres: string[];
  incGenresMode: GenreMode;
  excGenresMode: GenreMode;
  incTypes: SeriesType[];
  incDemographics: Demographic[];
  incContentRatings: ContentPreferenceRating[];
  releaseYearMin: number | null;
  releaseYearMax: number | null;
  origStatus: string | null;
  siteStatus: string | null;
  chapCount: string;
  ignoreGlobalULangs: boolean;
  ignoreGlobalGenres: boolean;
  ignoreGlobalBlocks: boolean;
}

export interface DateYmd {
  y?: number | null;
  m?: number | null;
  d?: number | null;
}

export interface NamedNode {
  id?: string;
  data?: {
    id?: string;
    name?: string;
    urlPath?: string;
  } | null;
}

export interface ChapterData {
  id: string;
  serial?: number | null;
  chaNum?: number | null;
  volNum?: number | null;
  dname?: string | null;
  title?: string | null;
  urlPath?: string | null;
  dateCreate?: number | null;
  dateModify?: number | null;
  datePublic?: number | null;
  userNode?: NamedNode | null;
  groupNodes?: Array<NamedNode | null> | null;
}

export interface ChapterNode {
  id: string;
  data: ChapterData;
}

export interface ComicData {
  id: string;
  dbStatus?: string | null;
  isPublic?: boolean | null;
  name: string;
  altNames?: string[] | null;
  authors?: string[] | null;
  artists?: string[] | null;
  originalLanguage?: string | null;
  translatedLanguage?: string | null;
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
  publishers?: string[] | null;
  authorNodes?: NamedNode[] | null;
  artistNodes?: NamedNode[] | null;
  tagNodes?: NamedNode[] | null;
  publisherNodes?: NamedNode[] | null;
  summary?: string | null;
  extraInfo?: string | null;
  urlPath?: string | null;
  urlCover?: string | null;
  is_hot?: boolean | null;
  is_new?: boolean | null;
  sfw_result?: boolean | null;
  score_val?: number | null;
  follows?: number | null;
  reviews?: number | null;
  comments_total?: number | null;
  chaps_normal?: number | null;
  chapterNodes_last?: ChapterNode[] | null;
}

export interface ComicNode {
  id: string;
  data: ComicData;
}

export interface BrowsePager {
  total?: number;
  pages?: number;
  page?: number;
  next?: number | null;
}

export interface BrowseResponse {
  get_comic_browse_pager?: BrowsePager | null;
  get_comic_browse_items?: ComicNode[] | null;
}

export interface ComicNodeResponse {
  get_comicNode?: ComicNode | null;
}

export interface ChapterListResult {
  paging?: BrowsePager | null;
  items?: ChapterNode[] | null;
}

export interface ChapterListResponse {
  get_comic_chapterList?: ChapterListResult | null;
}

export interface GraphQLResponse<T> {
  data?: T | null;
  errors?: Array<{ message?: string }> | null;
}
