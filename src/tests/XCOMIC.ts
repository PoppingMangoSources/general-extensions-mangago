import { ContentRating, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { getPreferences } from "../XCOMIC/forms/settings.js";
import { XCOMIC } from "../XCOMIC/main.js";
import { DEFAULT_CONTENT_RATINGS, DISCOVER_SECTIONS, SECTIONS } from "../XCOMIC/models.js";
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

  suite.test("mature source defaults exclude pornographic content", async () => {
    expect(sourceInfo.contentRating).to.equal(ContentRating.MATURE);
    expect(DEFAULT_CONTENT_RATINGS).to.deep.equal(["safe", "suggestive", "erotica"]);
    expect(getPreferences().contentRatings).to.deep.equal(DEFAULT_CONTENT_RATINGS);
  });

  suite.test("latest uploads contain valid chapter cards", async () => {
    const result = await XCOMIC.getDiscoverSectionItems(
      DISCOVER_SECTIONS[SECTIONS.LATEST_UPLOADS],
      undefined,
    );
    expect(result.items.length).to.equal(36);
    expect(
      result.items.every(
        (item) =>
          item.type === "chapterUpdatesCarouselItem" &&
          Boolean(item.mangaId) &&
          Boolean(item.chapterId) &&
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

  suite.test("globally numbered chapters are not regrouped by volume", async () => {
    const manga = await XCOMIC.getMangaDetails("x6bbg6");
    const chapters = await XCOMIC.getChapters(manga);
    const numbers = chapters.map((chapter) => chapter.chapNum);

    expect(chapters.length).to.be.greaterThan(0);
    expect(chapters.every((chapter) => chapter.volume === 0)).to.equal(true);
    expect(numbers).to.deep.equal([...numbers].sort((a, b) => b - a));
    expect(chapters.some((chapter) => chapter.title?.startsWith("Volume "))).to.equal(true);
  });

  await suite.run();
}
