import { DiscoverSectionType, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { LikeManga } from "../LikeManga/main.js";
import { SECTIONS } from "../LikeManga/models.js";
import { fetchHotPage } from "../LikeManga/network.js";
import { parseMangaList } from "../LikeManga/parsers.js";
import sourceInfo from "../LikeManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LikeManga tests", logger);
  registerDefaultTests(suite, LikeManga, sourceInfo);

  suite.test("Hot follows the site's dedicated feed", async () => {
    const expected = parseMangaList(await fetchHotPage()).map((item) => item.title);
    const result = await LikeManga.getDiscoverSectionItems(
      { id: SECTIONS.HOT, title: "Hot", type: DiscoverSectionType.prominentCarousel },
      undefined,
    );
    expect(expected.length).to.be.greaterThan(0);
    expect(result.items.map((item) => item.title)).to.deep.equal(expected);
  });

  await suite.run();
}
