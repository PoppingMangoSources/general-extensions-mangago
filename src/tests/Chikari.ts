import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { DEFAULT_SEARCH_TYPES } from "../Chikari/implementations/search-results-providing/models.js";
import { Chikari } from "../Chikari/main.js";
import sourceInfo from "../Chikari/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Chikari tests", logger);
  registerDefaultTests(suite, Chikari, sourceInfo);

  suite.test("discover separates comic and novel browsing", async () => {
    const sections = await Chikari.getDiscoverSections();
    expect(sections.map((section) => section.title)).to.deep.equal([
      "Popular",
      "Trending Comics",
      "Recently Updated Comics",
      "Trending Novels",
      "Recently Updated Novels",
      "Recently Added",
      "Most Bookmarked Comics",
      "Most Bookmarked Novels",
      "Popular by Type",
      "Top Rated by Type",
    ]);

    const recentlyAdded = sections.find((section) => section.title === "Recently Added");
    if (!recentlyAdded) throw new Error("Recently Added section is missing.");
    const recentlyAddedResults = await Chikari.getDiscoverSectionItems(recentlyAdded, undefined);
    expect(recentlyAddedResults.items).to.have.length(2);
    expect(recentlyAddedResults.items.map((item) => item.type)).to.deep.equal([
      "genresCarouselItem",
      "genresCarouselItem",
    ]);
    expect(recentlyAddedResults.items.map((item) => item.name)).to.deep.equal(["Comics", "Novels"]);
    expect(recentlyAddedResults.items.map((item) => item.searchQuery.metadata)).to.deep.equal([
      { sort: "added", types: ["manga", "manhwa", "manhua", "oel"] },
      { sort: "added", types: ["novel"] },
    ]);

    const latestNovels = sections.find((section) => section.title === "Recently Updated Novels");
    if (!latestNovels) throw new Error("Recently Updated Novels section is missing.");
    const results = await Chikari.getDiscoverSectionItems(latestNovels, undefined);
    expect(results.items.length).to.be.greaterThan(0);
    expect(results.items.every((item) => item.type === "chapterUpdatesCarouselItem")).to.equal(
      true,
    );
  });

  suite.test("novel chapters return XHTML", async () => {
    const novel = await Chikari.getMangaDetails("novel:shadow-slave");
    expect(novel.mangaInfo.contentType).to.equal("novel");

    const chapters = await Chikari.getChapters(novel);
    expect(chapters.length).to.be.greaterThan(0);

    const details = await Chikari.getChapterDetails(chapters[0]);
    expect(details.type).to.equal("html");
    if (details.type !== "html") throw new Error("Expected an HTML novel chapter.");
    expect(details.html).to.contain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(details.html).to.contain("<body>");
  });

  suite.test("search includes novels by default", async () => {
    const form = await Chikari.getAdvancedSearchForm({ title: "" });
    expect(DEFAULT_SEARCH_TYPES).to.deep.equal(["manga", "manhwa", "manhua", "novel"]);
    expect(form.getSearchQueryMetadata().types).to.deep.equal(DEFAULT_SEARCH_TYPES);

    const results = await Chikari.getSearchResults({ title: "Shadow Slave" }, undefined);
    expect(results.items.length).to.be.greaterThan(0);
    expect(results.items.some((item) => item.mangaId.startsWith("novel:"))).to.equal(true);
  });

  await suite.run();
}
