import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { TempleScan } from "../TempleScan/main.js";
import sourceInfo from "../TempleScan/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("TempleScan tests", logger);
  registerDefaultTests(suite, TempleScan, sourceInfo);

  suite.test("discover sections match the site", async () => {
    const sections = await TempleScan.getDiscoverSections();
    expect(sections.map((section) => section.title)).to.deep.equal([
      "Featured",
      "New Series",
      "Latest Updates",
      "Trending",
    ]);

    const featured = await TempleScan.getDiscoverSectionItems(sections[0], undefined);
    expect(featured.items.length).to.be.greaterThan(0);
    expect(featured.items.every((item) => item.type === "featuredCarouselItem")).to.equal(true);
    expect(
      featured.items.some(
        (item) => item.type === "featuredCarouselItem" && !!item.supertitle && !!item.summary,
      ),
    ).to.equal(true);

    const trending = await TempleScan.getDiscoverSectionItems(sections[3], undefined);
    const chips = trending.items.filter((item) => item.type === "genresCarouselItem");
    expect(chips.map((chip) => chip.name)).to.deep.equal(["Today", "This Week", "Monthly"]);
    for (const chip of chips) {
      const results = await TempleScan.getSearchResults(chip.searchQuery, undefined);
      expect(results.items.length).to.be.greaterThan(0);
    }
  });

  await suite.run();
}
