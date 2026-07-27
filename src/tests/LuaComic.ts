import { ContentRating, type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { LuaComic } from "../LuaComic/main.js";
import { parseChapterList, toLatestItems } from "../LuaComic/parsers.js";
import sourceInfo from "../LuaComic/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LuaComic tests", logger);
  registerDefaultTests(suite, LuaComic, sourceInfo);

  suite.test("paid chapters carry guarded ids and plain-text state", async () => {
    const sourceManga = {
      mangaId: "test-series",
      mangaInfo: {
        primaryTitle: "Test Series",
        thumbnailUrl: "",
        synopsis: "",
        contentRating: ContentRating.EVERYONE,
      },
    } as SourceManga;
    const chapters = parseChapterList(
      [
        { id: 1, chapter_slug: "chapter-1", chapter_name: "Chapter 1", price: 0 },
        {
          id: 2,
          chapter_slug: "chapter-2",
          chapter_name: "Chapter 2",
          chapter_title: "After Hours",
          price: 20,
        },
      ],
      sourceManga,
      true,
    );

    expect(chapters.map((chapter) => chapter.chapterId)).to.deep.equal([
      "chapter-1",
      "chapter-2#paid",
    ]);
    expect(chapters[1]?.title).to.equal("Paid - After Hours");

    let error: unknown;
    try {
      await LuaComic.getChapterDetails(chapters[1]);
    } catch (cause) {
      error = cause;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.contain("paid");
  });

  suite.test("update cards reject paid chapters in the free bucket", () => {
    const items = toLatestItems([
      {
        id: 1,
        series_slug: "test-series",
        title: "Test Series",
        free_chapters: [
          { id: 2, chapter_slug: "chapter-2", price: 10, created_at: "2026-01-02" },
          { id: 1, chapter_slug: "chapter-1", price: 0, created_at: "2026-01-01" },
        ],
      },
    ]);
    expect(items).to.have.length(1);
    expect(items[0]).to.include({ chapterId: "chapter-1" });
  });

  await suite.run();
}
