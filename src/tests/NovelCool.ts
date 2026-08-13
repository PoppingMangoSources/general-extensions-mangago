import { DiscoverSectionType, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { NovelCool } from "../NovelCool/main.js";
import { SECTIONS } from "../NovelCool/models.js";
import sourceInfo from "../NovelCool/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("NovelCool tests", logger);
  registerDefaultTests(suite, NovelCool, sourceInfo);

  suite.test("latest updates follow the current website feed", async () => {
    const result = await NovelCool.getDiscoverSectionItems(
      { id: SECTIONS.LATEST, title: "Latest", type: DiscoverSectionType.chapterUpdates },
      undefined,
    );
    expect(result.items.length).to.be.greaterThan(0);
    expect(result.items[0]?.title).not.to.equal("Apocalypse Descent: Farming With My Harem");
    expect(result.items[0]?.publishDate?.getUTCFullYear()).to.be.at.least(2026);
    expect(
      result.items.every(
        (item) =>
          item.type === "chapterUpdatesCarouselItem" &&
          Boolean(item.chapterId) &&
          item.publishDate instanceof Date,
      ),
    ).to.equal(true);
  });

  await suite.run();
}
