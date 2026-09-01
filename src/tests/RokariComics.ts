import { ContentRating, type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";
import * as cheerio from "cheerio";

import { RokariComics } from "../RokariComics/main.js";
import { STATE_KEYS } from "../RokariComics/models.js";
import sourceInfo from "../RokariComics/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("RokariComics tests", logger);
  registerDefaultTests(suite, RokariComics, sourceInfo);

  suite.test("locked chapters are hidden by default and guarded when shown", async () => {
    const sourceManga = {
      mangaId: "test-series",
      mangaInfo: {
        primaryTitle: "Test Series",
        thumbnailUrl: "",
        synopsis: "",
        contentRating: ContentRating.EVERYONE,
      },
    } as SourceManga;
    const chapterPage = () =>
      cheerio.load(`
        <div id="chapterlist"><ul>
          <li data-num="2">
            <span class="chapternum">Chapter 2</span>
            <span class="chapterdate">January 2, 2026</span>
            <span class="text-gold"></span>
          </li>
          <li data-num="1">
            <span class="chapternum">Chapter 1</span>
            <span class="chapterdate">January 1, 2026</span>
          </li>
        </ul></div>
      `);

    Application.setState(undefined, STATE_KEYS.SHOW_LOCKED_CHAPTERS);
    expect(
      RokariComics.parser.parseChapterList(chapterPage(), sourceManga, RokariComics),
    ).to.have.length(1);

    Application.setState(true, STATE_KEYS.SHOW_LOCKED_CHAPTERS);
    const chapters = RokariComics.parser.parseChapterList(chapterPage(), sourceManga, RokariComics);
    expect(chapters.map(({ chapterId, title }) => ({ chapterId, title }))).to.deep.equal([
      { chapterId: "2#locked", title: "Chapter 2 (LOCKED)" },
      { chapterId: "1", title: "Chapter 1" },
    ]);

    let error: unknown;
    try {
      await RokariComics.getChapterDetails(chapters[0]);
    } catch (cause) {
      error = cause;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.contain("locked");
    Application.setState(undefined, STATE_KEYS.SHOW_LOCKED_CHAPTERS);
  });

  await suite.run();
}
