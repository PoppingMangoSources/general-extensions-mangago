import { ContentRating, type Chapter, type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { ValirScans } from "../ValirScans/main.js";
import { parseChapterDetails, parseChapters, toChapterUpdateItems } from "../ValirScans/parsers.js";
import sourceInfo from "../ValirScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ValirScans tests", logger);
  registerDefaultTests(suite, ValirScans, sourceInfo);

  suite.test("locked chapters carry guarded ids and lock markers", async () => {
    const sourceManga = {
      mangaId: "test-series",
      mangaInfo: {
        primaryTitle: "Test Series",
        thumbnailUrl: "",
        synopsis: "",
        contentRating: ContentRating.EVERYONE,
      },
    } as SourceManga;
    const chapters = parseChapters(
      [
        {
          series: { slug: "test-series", title: "Test Series" },
          chapters: [
            { id: "1", number: 1, isLocked: false },
            { id: "duplicate-1", number: 1, isLocked: false },
            { id: "2", number: 2, title: "After Hours", isLocked: true },
            { id: "3", number: 3, title: "Purchased", isLocked: true, hasAccess: true },
          ],
        },
      ],
      sourceManga,
      true,
    );

    expect(chapters.map((chapter) => chapter.chapterId)).to.deep.equal(["1", "locked:2", "3"]);
    expect(chapters[1]?.title).to.equal("After Hours (LOCKED)");
    expect(chapters[2]?.title).to.equal("Purchased");

    let error: unknown;
    try {
      await ValirScans.getChapterDetails(chapters[1]);
    } catch (cause) {
      error = cause;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.contain("locked");
  });

  suite.test("reader unlock state overrides paid chapter flags", () => {
    const chapter = {
      chapterId: "3",
      sourceManga: { mangaId: "comic/test-series" },
    } as Chapter;
    const details = parseChapterDetails(
      '{"chapter":{"pages":[{"pageNumber":1,"imageUrl":"/page.webp"}],"isLocked":true},"isUnlocked":true}',
      chapter,
    );
    expect(details.pages).to.deep.equal(["https://valirscans.org/page.webp"]);

    expect(() =>
      parseChapterDetails(
        '{"chapter":{"pages":[{"pageNumber":1,"imageUrl":""}]},"isUnlocked":false}',
        chapter,
      ),
    ).to.throw("locked on ValirScans");
  });

  suite.test("update cards omit series with only locked chapters", () => {
    expect(
      toChapterUpdateItems(
        [
          {
            slug: "paid-only",
            title: "Paid Only",
            type: "comic",
            chapters: [{ id: "1", number: 1, isLocked: true }],
          },
        ],
        false,
      ),
    ).to.deep.equal([]);
  });

  await suite.run();
}
