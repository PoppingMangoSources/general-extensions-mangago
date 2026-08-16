import { ContentRating, type Tag, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { getPreferences } from "../XCOMIC/forms/settings.js";
import { XCOMIC } from "../XCOMIC/main.js";
import {
  CHAPTER_COUNT_OPTIONS,
  DEFAULT_CONTENT_RATINGS,
  DISCOVER_SECTIONS,
  MOST_VIEWS_OPTIONS,
  SECTIONS,
  STATE_KEYS,
} from "../XCOMIC/models.js";
import { fetchRecentlyAdded } from "../XCOMIC/network.js";
import { parseRecentlyAdded } from "../XCOMIC/parsers.js";
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
    await XCOMIC.getAdvancedSearchForm({ title: "" });
    const genres = Application.getState(STATE_KEYS.GENRES) as Tag[] | undefined;
    expect(genres?.length).to.be.greaterThan(100);
    expect(genres?.some((item) => item.id === "action")).to.equal(true);
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

  suite.test("mature source defaults exclude pornographic content", async () => {
    expect(sourceInfo.contentRating).to.equal(ContentRating.MATURE);
    expect(DEFAULT_CONTENT_RATINGS).to.deep.equal(["safe", "suggestive", "erotica"]);
    expect(getPreferences().contentRatings).to.deep.equal(DEFAULT_CONTENT_RATINGS);
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
    const mostViews = sections.find((section) => section.id === SECTIONS.MOST_VIEWS);
    if (!mostViews) throw new Error("Most Views section is missing");
    const sectionItems = await XCOMIC.getDiscoverSectionItems(mostViews, undefined);
    const chips = sectionItems.items.filter((item) => item.type === "genresCarouselItem");
    expect(chips.map((chip) => chip.name)).to.deep.equal(
      MOST_VIEWS_OPTIONS.map((option) => option.chipLabel),
    );
    expect(chips.map((chip) => chip.searchQuery.metadata?.sort)).to.deep.equal(
      MOST_VIEWS_OPTIONS.map((option) => option.id),
    );

    for (const chip of chips) {
      const results = await XCOMIC.getSearchResults(chip.searchQuery, undefined);
      expect(results.items.length, chip.name).to.be.greaterThan(0);
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
    expect(result.items.length).to.be.at.most(36);
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

  suite.test("recently added matches the site's canonical feed", async () => {
    const siteFeed = parseRecentlyAdded(await fetchRecentlyAdded(), 1);
    const recentlyAdded = await XCOMIC.getDiscoverSectionItems(
      DISCOVER_SECTIONS[SECTIONS.RECENTLY_ADDED],
      undefined,
    );
    expect(recentlyAdded.items.map((item) => item.mangaId)).to.deep.equal(
      siteFeed.items.map((item) => item.mangaId),
    );
    expect(
      recentlyAdded.items.every((item) => item.imageUrl.startsWith("https://xcomic.me/")),
    ).to.equal(true);

    const searchResults = await XCOMIC.getSearchResults({ title: "" }, undefined, {
      id: "field_create",
      label: "Recently Added",
    });
    expect(searchResults.items.map((item) => item.mangaId)).to.deep.equal(
      siteFeed.items.map((item) => item.mangaId),
    );

    if (siteFeed.nextPage && recentlyAdded.metadata && searchResults.metadata) {
      const expectedNextPage = parseRecentlyAdded(await fetchRecentlyAdded(), siteFeed.nextPage);
      const discoverNextPage = await XCOMIC.getDiscoverSectionItems(
        DISCOVER_SECTIONS[SECTIONS.RECENTLY_ADDED],
        recentlyAdded.metadata,
      );
      const searchNextPage = await XCOMIC.getSearchResults({ title: "" }, searchResults.metadata, {
        id: "field_create",
        label: "Recently Added",
      });
      expect(discoverNextPage.items.map((item) => item.mangaId)).to.deep.equal(
        expectedNextPage.items.map((item) => item.mangaId),
      );
      expect(searchNextPage.items.map((item) => item.mangaId)).to.deep.equal(
        expectedNextPage.items.map((item) => item.mangaId),
      );
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
