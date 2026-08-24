import { ContentRating, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { getPreferences } from "../XCOMIC/forms/settings.js";
import { XCOMIC } from "../XCOMIC/main.js";
import {
  CHAPTER_COUNT_OPTIONS,
  CONTENT_RATING_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  DISCOVER_SECTIONS,
  FORMAT_OPTIONS,
  MOST_VIEWS_OPTIONS,
  PAGE_SIZE,
  SECTIONS,
  STATE_KEYS,
  type BrowseSelect,
  type ComicData,
  type FilterOptions,
} from "../XCOMIC/models.js";
import { fetchBrowse, fetchRecentlyAdded, fetchSearchPage } from "../XCOMIC/network.js";
import { isComicAllowed, parseFilterOptions, toSearchResultItem } from "../XCOMIC/parsers.js";
import sourceInfo from "../XCOMIC/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("XCOMIC tests", logger);
  registerDefaultTests(suite, XCOMIC, sourceInfo);

  suite.test("genre modes use full-width AND/OR controls", async () => {
    const form = await XCOMIC.getAdvancedSearchForm({
      title: "",
      metadata: { incGenresMode: "or", excGenresMode: "and" },
    });
    const sections = form
      .getSections()
      .filter((section) => section.id === "include_mode" || section.id === "exclude_mode");
    expect(sections.map((section) => section.type)).to.deep.equal(["flowSection", "flowSection"]);
    expect(sections.map((section) => section.items.map((item) => item.id))).to.deep.equal([
      ["and", "or"],
      ["and", "or"],
    ]);
    expect(form.getSearchQueryMetadata()).to.deep.include({
      incGenresMode: "or",
      excGenresMode: "and",
    });
  });

  suite.test("search filters follow the current site taxonomy", async () => {
    const filters: FilterOptions = parseFilterOptions(await fetchSearchPage());
    expect(filters.genres.length).to.be.greaterThan(100);
    expect(filters.genres.some((item) => item.id === "action")).to.equal(true);
    expect(filters.types.map((item) => item.id)).to.include.members(["manga", "manhwa", "manhua"]);
    expect(filters.demographics.map((item) => item.id)).to.include.members([
      "shounen",
      "shoujo",
      "seinen",
      "josei",
    ]);
    expect(filters.contentRatings.map((item) => item.id)).to.deep.equal(
      CONTENT_RATING_OPTIONS.map((item) => item.id),
    );
    expect(FORMAT_OPTIONS.some((item) => item.id === "webtoon")).to.equal(true);
    expect(CHAPTER_COUNT_OPTIONS.map((option) => option.id)).to.include.members([
      "60",
      "70",
      "80",
      "90",
      "60-69",
      "70-79",
      "80-89",
      "90-99",
    ]);
  });

  suite.test("every rating ships enabled and stays individually filterable", async () => {
    expect(sourceInfo.contentRating).to.equal(ContentRating.ADULT);
    expect(DEFAULT_CONTENT_RATINGS).to.deep.equal(
      CONTENT_RATING_OPTIONS.map((option) => option.id),
    );
    expect(getPreferences().contentRatings).to.deep.equal(DEFAULT_CONTENT_RATINGS);
    const comic = {
      id: "rating-test",
      name: "Rating test",
      translatedLanguage: "en",
      type: "manga",
      urlCover: "/cover.jpg",
    } satisfies ComicData;
    for (const option of CONTENT_RATING_OPTIONS) {
      const allowedRatings = CONTENT_RATING_OPTIONS.map(({ id }) => id).filter(
        (id) => id !== option.id,
      );
      expect(
        isComicAllowed(
          { ...comic, contentRating: option.id },
          {
            contentRatings: allowedRatings,
            excludedFormats: [],
            excludedGenres: [],
            types: ["manga"],
          },
          true,
        ),
        `${option.title} was not filtered when unchecked`,
      ).to.equal(false);
      expect(
        isComicAllowed(
          { ...comic, contentRating: option.id },
          {
            contentRatings: [option.id],
            excludedFormats: [],
            excludedGenres: [],
            types: ["manga"],
          },
          true,
        ),
        `${option.title} was filtered while selected`,
      ).to.equal(true);
    }
    // Paperback collapses erotica and pornographic into ADULT; genres escalate a mild declaration.
    expect(
      toSearchResultItem({ data: { ...comic, contentRating: "erotica" } }).contentRating,
    ).to.equal(ContentRating.ADULT);
    expect(
      toSearchResultItem({ data: { ...comic, contentRating: "suggestive" } }).contentRating,
    ).to.equal(ContentRating.MATURE);
    expect(
      toSearchResultItem({ data: { ...comic, contentRating: "safe", genres: ["hentai"] } })
        .contentRating,
    ).to.equal(ContentRating.ADULT);
    expect(
      toSearchResultItem({ data: { ...comic, contentRating: "brand_new_rating" } }).contentRating,
    ).to.equal(ContentRating.ADULT);
  });

  suite.test("catalog sorts and most-view chips follow the live API", async () => {
    const sortingOptions = await XCOMIC.getSortingOptions();
    const addedSortIds = [
      "field_follow",
      "field_review",
      "field_comment",
      ...MOST_VIEWS_OPTIONS.map((option) => option.id),
    ];
    expect(sortingOptions.map((option) => option.id)).to.include.members(addedSortIds);
    expect(sortingOptions.some((option) => option.id.startsWith("status_"))).to.equal(false);

    const sections = await XCOMIC.getDiscoverSections();
    expect(sections.slice(0, 2).map((section) => section.id)).to.deep.equal([
      SECTIONS.TOP_RATED,
      SECTIONS.MOST_VIEWS,
    ]);
    const mostViews = sections.find((section) => section.id === SECTIONS.MOST_VIEWS);
    if (!mostViews) throw new Error("Most Views section is missing");
    const sectionItems = await XCOMIC.getDiscoverSectionItems(mostViews, undefined);
    const chips = sectionItems.items.filter((item) => item.type === "genresCarouselItem");
    expect(chips.map((chip) => chip.name)).to.deep.equal(
      MOST_VIEWS_OPTIONS.map((option) => option.chipLabel),
    );
    expect(chips.map((chip) => chip.searchQuery.metadata?.discoverSort)).to.deep.equal(
      MOST_VIEWS_OPTIONS.map((option) => option.id),
    );

    for (const chip of chips.filter((item) =>
      ["views_d360", "views_d090", "views_h001"].includes(
        String(item.searchQuery.metadata?.discoverSort),
      ),
    )) {
      const results = await XCOMIC.getSearchResults(chip.searchQuery, undefined, {
        id: "field_score",
        label: "Rating Score",
      });
      const sortby = chip.searchQuery.metadata?.discoverSort;
      if (!sortby) throw new Error(`Most Views chip has no sort: ${chip.name}`);
      const preferences = getPreferences();
      const expectedSelect: BrowseSelect = {
        where: "browse",
        page: 1,
        size: PAGE_SIZE,
        init: 0,
        sortby,
        word: "",
        incOLangs: [],
        incTLangs: ["en"],
        incGenres: [],
        excGenres: [],
        incGenresMode: "and",
        excGenresMode: "or",
        incTypes: preferences.types,
        incDemographics: [],
        incContentRatings: preferences.contentRatings,
        releaseYearMin: null,
        releaseYearMax: null,
        origStatus: null,
        siteStatus: null,
        chapCount: "",
        ignoreGlobalULangs: true,
        ignoreGlobalGenres: true,
        ignoreGlobalBlocks: true,
      };
      const expected = (await fetchBrowse(expectedSelect)).get_comic_browse_items ?? [];
      const expectedIds = expected
        .filter((item) => isComicAllowed(item.data, preferences))
        .map((item) => item.data.id);
      expect(results.items.length, chip.name).to.be.greaterThan(0);
      expect(results.items.length, `${chip.name} refetched beyond one browse page`).to.be.at.most(
        PAGE_SIZE,
      );
      expect(
        results.items.map((item) => item.mangaId),
        `${chip.name} did not preserve the site's ranking order`,
      ).to.deep.equal(expectedIds);
      expect(
        results.items.every((item) => item.imageUrl.startsWith("https://xcomic.me/")),
        chip.name,
      ).to.equal(true);
    }

    for (const id of ["field_follow", "field_review", "field_comment"]) {
      const sortingOption = sortingOptions.find((option) => option.id === id);
      if (!sortingOption) throw new Error(`Missing sorting option: ${id}`);
      const results = await XCOMIC.getSearchResults({ title: "" }, undefined, sortingOption);
      expect(results.items.length, sortingOption.label).to.be.greaterThan(0);
    }
  });

  suite.test("latest uploads contain valid chapter cards", async () => {
    const result = await XCOMIC.getDiscoverSectionItems(
      DISCOVER_SECTIONS[SECTIONS.LATEST_UPLOADS],
      undefined,
    );
    expect(result.items.length).to.be.greaterThan(0);
    expect(
      result.items.every(
        (item) =>
          item.type === "chapterUpdatesCarouselItem" &&
          Boolean(item.mangaId) &&
          Boolean(item.chapterId) &&
          item.imageUrl.startsWith("https://xcomic.me/") &&
          item.chapterId.startsWith("/comic/") &&
          item.publishDate instanceof Date,
      ),
    ).to.equal(true);
    const publishTimes = result.items.map((item) => item.publishDate?.getTime() ?? 0);
    expect(publishTimes).to.deep.equal([...publishTimes].sort((a, b) => b - a));

    if (result.metadata) {
      const nextPage = await XCOMIC.getDiscoverSectionItems(
        DISCOVER_SECTIONS[SECTIONS.LATEST_UPLOADS],
        result.metadata,
      );
      const firstPageIds = new Set(result.items.map((item) => item.mangaId));
      expect(nextPage.items.length).to.be.greaterThan(0);
      expect(
        nextPage.items.every(
          (item) =>
            item.type === "chapterUpdatesCarouselItem" &&
            Boolean(item.mangaId) &&
            Boolean(item.chapterId) &&
            !firstPageIds.has(item.mangaId),
        ),
      ).to.equal(true);
    }
  });

  suite.test("recently added mirrors the site's own feed order", async () => {
    const feedIds = ((await fetchRecentlyAdded()).get_comic_recentlyAdded?.items ?? []).map(
      (node) => node.data.id,
    );
    expect(feedIds.length).to.be.greaterThan(0);
    const recentlyAdded = await XCOMIC.getDiscoverSectionItems(
      DISCOVER_SECTIONS[SECTIONS.RECENTLY_ADDED],
      undefined,
    );
    const resultIds = recentlyAdded.items.map((item) => item.mangaId);
    expect(resultIds.length).to.be.greaterThan(0);
    expect(resultIds.every((id) => feedIds.includes(id))).to.equal(true);
    const feedIndexes = resultIds.map((id) => feedIds.indexOf(id));
    expect(feedIndexes).to.deep.equal(feedIndexes.toSorted((a, b) => a - b));
    expect(
      recentlyAdded.items.every((item) => item.imageUrl.startsWith("https://xcomic.me/")),
    ).to.equal(true);
    // The feed is complete in one request, so the section must not advertise another page.
    expect(recentlyAdded.metadata).to.equal(undefined);
  });

  suite.test("unchecked ratings are filtered from search and discover", async () => {
    const previousRatings = Application.getState(STATE_KEYS.CONTENT_RATINGS);
    Application.setState(["safe"], STATE_KEYS.CONTENT_RATINGS);
    try {
      const search = await XCOMIC.getSearchResults(
        { title: "", metadata: { contentRatings: ["safe"] } },
        undefined,
      );
      expect(search.items.length).to.be.greaterThan(0);
      expect(search.items.every((item) => item.contentRating === ContentRating.EVERYONE)).to.equal(
        true,
      );

      for (const sectionId of [
        SECTIONS.TOP_RATED,
        SECTIONS.LATEST_UPLOADS,
        SECTIONS.RECENTLY_ADDED,
      ]) {
        const section = await XCOMIC.getDiscoverSectionItems(
          DISCOVER_SECTIONS[sectionId],
          undefined,
        );
        expect(section.items.length, sectionId).to.be.greaterThan(0);
        expect(
          section.items.every((item) => item.contentRating === ContentRating.EVERYONE),
          sectionId,
        ).to.equal(true);
      }
    } finally {
      Application.setState(previousRatings, STATE_KEYS.CONTENT_RATINGS);
    }
  });

  suite.test("globally numbered chapters are not regrouped by volume", async () => {
    const manga = await XCOMIC.getMangaDetails("x6bbg6");
    const chapters = await XCOMIC.getChapters(manga);
    const numbers = chapters.map((chapter) => chapter.chapNum);

    expect(chapters.length).to.be.greaterThan(0);
    expect(chapters.every((chapter) => chapter.volume === 0)).to.equal(true);
    expect(numbers).to.deep.equal([...numbers].sort((a, b) => b - a));
    expect(chapters.some((chapter) => chapter.title?.startsWith("Volume "))).to.equal(true);
  });

  suite.test("chapter groups use the source name returned by XCOMIC", async () => {
    const manga = await XCOMIC.getMangaDetails("5xwzll");
    const chapters = await XCOMIC.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    expect(chapters.some((chapter) => chapter.version === "Mbato")).to.equal(true);
  });

  suite.test("multi-page chapters and reader use the GraphQL payloads", async () => {
    const manga = await XCOMIC.getMangaDetails("vg7ypp");
    const chapters = await XCOMIC.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(200);
    const details = await XCOMIC.getChapterDetails(chapters[0]!);
    expect(details.pages.length).to.be.greaterThan(0);
    expect(details.pages.every((page) => page.startsWith("https://xcomic.me/_f/"))).to.equal(true);
  });

  await suite.run();
}
