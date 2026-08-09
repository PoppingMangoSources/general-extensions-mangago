import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { XCOMIC } from "../XCOMIC/main.js";
import { DISCOVER_SECTIONS, SECTIONS } from "../XCOMIC/models.js";
import sourceInfo from "../XCOMIC/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("XCOMIC tests", logger);
  registerDefaultTests(suite, XCOMIC, sourceInfo);

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
          Boolean(item.chapterId),
      ),
    ).to.equal(true);

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

  await suite.run();
}
