import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { VyManga } from "../VyManga/main.js";
import sourceInfo from "../VyManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("VyManga tests", logger);
  registerDefaultTests(suite, VyManga, sourceInfo);

  suite.test("genre chips submit the site's distinct filter values", async () => {
    const sections = await VyManga.getDiscoverSections();
    const section = sections.find((item) => item.id === "genres");
    expect(section).to.not.equal(undefined);

    const genres = await VyManga.getDiscoverSectionItems(section!, undefined);
    const action = genres.items.find(
      (item) => item.type === "genresCarouselItem" && item.name === "Action",
    );
    const romance = genres.items.find(
      (item) => item.type === "genresCarouselItem" && item.name === "Romance",
    );
    expect(action?.type).to.equal("genresCarouselItem");
    expect(romance?.type).to.equal("genresCarouselItem");
    if (action?.type !== "genresCarouselItem" || romance?.type !== "genresCarouselItem") return;

    const [actionResults, romanceResults] = await Promise.all([
      VyManga.getSearchResults(action.searchQuery, undefined),
      VyManga.getSearchResults(romance.searchQuery, undefined),
    ]);
    expect(actionResults.items.length).to.be.greaterThan(0);
    expect(romanceResults.items.length).to.be.greaterThan(0);
    expect(actionResults.items.map((item) => item.mangaId)).to.not.deep.equal(
      romanceResults.items.map((item) => item.mangaId),
    );
  });

  await suite.run();
}
