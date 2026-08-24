import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MangaHere } from "../MangaHere/main.js";
import sourceInfo from "../MangaHere/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaHere tests", logger);
  registerDefaultTests(suite, MangaHere, sourceInfo, { chapterProviding: false });

  suite.test("discover exposes the site sections", async () => {
    const sections = await MangaHere.getDiscoverSections();
    expect(sections.map((section) => section.title)).to.deep.equal([
      "Most Popular",
      "Recommended",
      "New Manga Releases",
      "Latest Updates",
      "Ranking",
      "Being Read Right Now",
      "Trending Manga",
      "Hot Manga Releases",
      "Genres",
    ]);

    const results = await Promise.all(
      sections.map((section) => MangaHere.getDiscoverSectionItems(section, undefined)),
    );
    expect(results[0].items.length).to.be.greaterThan(0);
    expect(results[0].items.every((item) => item.type === "featuredCarouselItem")).to.equal(true);
    expect(results[1].items.every((item) => item.type === "simpleCarouselItem")).to.equal(true);
    expect(results[2].items.every((item) => item.type === "simpleCarouselItem")).to.equal(true);
    expect(results[3].items.every((item) => item.type === "chapterUpdatesCarouselItem")).to.equal(
      true,
    );
    expect(results[4].items.map((item) => item.name)).to.deep.equal(["Daily", "Weekly", "Monthly"]);
    expect(results[8].items.length).to.equal(37);
  });

  suite.test("chapters use zero for missing volumes", async () => {
    const manga = await MangaHere.getMangaDetails("onepunch_man");
    const chapters = await MangaHere.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    expect(chapters.every((chapter) => chapter.volume === 0)).to.equal(true);
  });

  suite.test("ranking chips return ranked titles", async () => {
    const results = await MangaHere.getSearchResults(
      { title: "", metadata: { rankingPeriod: "daily" } },
      undefined,
    );
    expect(results.items.length).to.be.greaterThan(0);
    expect(results.items[0].subtitle).to.match(/^#1(?: • |$)/);
  });

  await suite.run();
}
