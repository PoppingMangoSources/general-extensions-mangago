import { ContentRating, type Chapter, type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";
import * as cheerio from "cheerio";

import { RinkoComics } from "../RinkoComics/main.js";
import { toLatestItems } from "../RinkoComics/parsers.js";
import sourceInfo from "../RinkoComics/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("RinkoComics tests", logger);
  registerDefaultTests(suite, RinkoComics, sourceInfo);

  suite.test("locked chapter ids are rejected before loading the reader", async () => {
    const sourceManga = {
      mangaId: "test-series",
      mangaInfo: {
        primaryTitle: "Test Series",
        thumbnailUrl: "",
        synopsis: "",
        contentRating: ContentRating.EVERYONE,
      },
    } as SourceManga;
    const chapter = {
      chapterId: "locked-1#lock",
      sourceManga,
      title: "🔒",
      chapNum: 1,
      langCode: "en",
    } as Chapter;

    let error: unknown;
    try {
      await RinkoComics.getChapterDetails(chapter);
    } catch (cause) {
      error = cause;
    }
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.contain("locked");
  });

  suite.test("update cards skip chapters marked locked despite having a URL", () => {
    const $ = cheerio.load(`
      <div class="latest-releases">
        <div class="comic-card">
          <a class="comic-card__cover" href="/comic/test-series"><img src="/cover.jpg"/></a>
          <div class="comic-card__title">Test Series</div>
          <a class="chapter-item" href="/chapter/2" data-reason="coins"><label>Chapter 2</label></a>
          <a class="chapter-item" href="/chapter/1"><label>Chapter 1</label></a>
        </div>
      </div>
    `);
    expect(toLatestItems($)[0]).to.include({ chapterId: "chapter/1" });
  });

  await suite.run();
}
