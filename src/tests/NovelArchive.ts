import { ContentRating, type Chapter, type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { NovelArchive } from "../NovelArchive/main.js";
import {
  parseChapterDetails,
  parseNovelList,
  parseSourceChapterDetails,
} from "../NovelArchive/parsers.js";
import sourceInfo from "../NovelArchive/pbconfig.js";
import { repairMojibake } from "../NovelArchive/utils.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("NovelArchive tests", logger);
  registerDefaultTests(suite, NovelArchive, sourceInfo);

  suite.test("navigation labels are not exposed as genres", () => {
    const [novel] = parseNovelList([
      {
        id: "test",
        title: "Test Novel",
        genres:
          "Browse,Completed Novel,Completed Novels,Latest Novel,Latest Novels,Anime & Comics,Anime and Comics,Fantasy,Fantasy",
      },
    ]);

    expect(novel?.genres).to.deep.equal(["Fantasy"]);
  });

  const sourceManga: SourceManga = {
    mangaId: "test",
    mangaInfo: {
      primaryTitle: "Test Novel",
      secondaryTitles: [],
      thumbnailUrl: "",
      contentRating: ContentRating.EVERYONE,
    },
  };
  const chapter: Chapter = {
    chapterId: "1",
    sourceManga,
    langCode: "en",
    chapNum: 1,
    title: "Chapter 1",
    version: "NovelArchive",
  };

  suite.test("native chapter text normalizes HTML entities", () => {
    const details = parseChapterDetails({ content: "First&nbsp;line\u00a0here" }, chapter);
    expect(details.html).to.contain("<p>First line here</p>");
    expect(details.html).not.to.contain("&amp;nbsp;");
  });

  suite.test("mirror chapter HTML repairs encoding and closes void tags", () => {
    const details = parseSourceChapterDetails(
      { content_html: "<p>FranÃ§ais<br>Next</p>" },
      chapter,
    );
    expect(repairMojibake("FranÃ§ais")).to.equal("Français");
    expect(details.html).not.to.contain("FranÃ");
    expect(details.html).to.contain("<br/>Next</p>");
  });

  await suite.run();
}
