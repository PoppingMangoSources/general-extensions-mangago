import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { StoneScape } from "../StoneScape/main.js";
import sourceInfo from "../StoneScape/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("StoneScape tests", logger);
  registerDefaultTests(suite, StoneScape, sourceInfo);

  suite.test("discover sections expose the site rails", async () => {
    const sections = await StoneScape.getDiscoverSections();
    expect(sections.map((section) => section.title)).to.deep.equal([
      "Featured Series",
      "Popular Series",
      "Latest Releases",
      "Novels",
      "Latest Novels",
      "Popular Novels",
      "Genres",
    ]);

    const [featured, popular, latest, novels, latestNovels, popularNovels, genres] =
      await Promise.all(
        sections.map((section) => StoneScape.getDiscoverSectionItems(section, undefined)),
      );

    expect(featured.items.length).to.be.greaterThan(0);
    expect(featured.items.every((item) => item.type === "featuredCarouselItem")).to.equal(true);
    expect(
      featured.items.every(
        (item) =>
          item.type === "featuredCarouselItem" &&
          !!item.title &&
          !!item.imageUrl &&
          !!item.supertitle,
      ),
    ).to.equal(true);

    expect(popular.items.map((item) => item.type)).to.deep.equal([
      "genresCarouselItem",
      "genresCarouselItem",
      "genresCarouselItem",
    ]);
    expect(
      popular.items.map((item) => (item.type === "genresCarouselItem" ? item.name : "")),
    ).to.deep.equal(["Week", "Month", "Year"]);

    expect(latest.items.length).to.be.greaterThan(0);
    expect(latest.items.every((item) => item.type === "chapterUpdatesCarouselItem")).to.equal(true);
    expect(novels.items.length).to.be.greaterThan(0);
    expect(novels.items.every((item) => item.type === "featuredCarouselItem")).to.equal(true);
    expect(latestNovels.items.length).to.be.greaterThan(0);
    expect(latestNovels.items.every((item) => item.type === "chapterUpdatesCarouselItem")).to.equal(
      true,
    );
    expect(
      popularNovels.items.map((item) => (item.type === "genresCarouselItem" ? item.name : "")),
    ).to.deep.equal(["Week", "Month", "Year"]);
    expect(genres.items.length).to.be.greaterThan(0);
    expect(genres.items.every((item) => item.type === "genresCarouselItem")).to.equal(true);
  });

  suite.test("novel chapters return XHTML", async () => {
    const novel = await StoneScape.getMangaDetails("shadow-slave");
    expect(novel.mangaInfo.contentType).to.equal("novel");

    const chapters = await StoneScape.getChapters(novel);
    expect(chapters.length).to.be.greaterThan(0);

    const details = await StoneScape.getChapterDetails(chapters[0]);
    expect(details.type).to.equal("html");
    if (details.type !== "html") throw new Error("Expected an HTML novel chapter.");
    expect(details.html).to.contain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(details.html).to.contain("<body>");
  });

  await suite.run();
}
