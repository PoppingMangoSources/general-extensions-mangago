import { ContentRating, type SourceManga, type TestLogger } from "@paperback/types";
import { expect } from "chai";
import * as cheerio from "cheerio";

import { Cocomic } from "../Cocomic/main.js";
import { SORT_OPTIONS } from "../Cocomic/models.js";
import { parseChapters, toFeaturedItem } from "../Cocomic/parsers.js";
import sourceInfo from "../Cocomic/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Cocomic tests", logger);
  registerDefaultTests(suite, Cocomic, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "Kiss Me If You Can" }, undefined, SORT_OPTIONS[0]],
    },
  });

  suite.test("discover follows the site section order", async () => {
    const sections = await Cocomic.getDiscoverSections();
    expect(sections.map((section) => section.title)).to.deep.equal([
      "Top Rated",
      "Only Cocomic",
      "New Releases",
      "Latest Updates",
      "Today's Official",
      "Yaoi",
      "Manhwa",
      "Smut",
    ]);
  });

  suite.test("all requested discovery rails return site content", async () => {
    const sections = await Cocomic.getDiscoverSections();
    for (const section of sections.filter((candidate) => candidate.title !== "Latest Updates")) {
      const result = await Cocomic.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.title).to.be.greaterThan(0);
    }
  });

  suite.test("advanced search mirrors the site controls", async () => {
    const form = await Cocomic.getAdvancedSearchForm({
      title: "",
      metadata: {
        genres: { yaoi: "included" },
        genreMatch: ["and"],
        author: "Example Author",
        artist: "Example Artist",
        releaseYear: "2026",
        adult: ["1"],
        statuses: ["on-going", "end"],
      },
    });
    expect(form.getSections().map((section) => section.id)).to.deep.equal([
      "genres",
      "genre_match",
      "credits",
      "adult",
      "status",
    ]);
    expect(form.getSearchQueryMetadata()).to.deep.equal({
      genres: { yaoi: "included" },
      genreMatch: ["and"],
      author: "Example Author",
      artist: "Example Artist",
      releaseYear: "2026",
      adult: ["1"],
      statuses: ["on-going", "end"],
    });
  });

  suite.test("latest updates include chapter and time metadata", async () => {
    const section = (await Cocomic.getDiscoverSections()).find(
      (candidate) => candidate.title === "Latest Updates",
    );
    if (!section) throw new Error("Latest Updates section is missing.");
    const result = await Cocomic.getDiscoverSectionItems(section, undefined);
    expect(result.items.length).to.be.greaterThan(0);
    expect(
      result.items.every(
        (item) =>
          item.type === "chapterUpdatesCarouselItem" &&
          Boolean(item.chapterId) &&
          Boolean(item.subtitle) &&
          item.publishDate instanceof Date,
      ),
    ).to.equal(true);
  });

  suite.test("premium and duplicate chapters are removed", async () => {
    const manga = {
      mangaId: "example",
      mangaInfo: { primaryTitle: "Example" },
    } as SourceManga;
    const chapters = parseChapters(
      cheerio.load(`
        <ul>
          <li class="wp-manga-chapter free-chap"><a href="/manga/example/chapter-2/">Chapter 2</a></li>
          <li class="wp-manga-chapter premium"><a href="/manga/example/chapter-3/">Chapter 3</a></li>
          <li class="wp-manga-chapter free-chap"><a href="/manga/example/chapter-2/">Chapter 2</a></li>
          <li class="wp-manga-chapter free-chap"><a href="/manga/example/chapter-1/">Chapter 1</a></li>
        </ul>
      `),
      manga,
    );
    expect(chapters.map((chapter) => chapter.chapterId)).to.deep.equal(["chapter-2", "chapter-1"]);
  });

  suite.test("featured cards show chapter numbers instead of chapter titles", async () => {
    const base = {
      mangaId: "example",
      title: "Example",
      imageUrl: "https://cocomic.co/example.jpg",
      contentRating: ContentRating.EVERYONE,
      genres: [],
      rating: 5,
    };
    expect(
      toFeaturedItem({
        ...base,
        chapter: { chapterId: "chapter-113", title: "The Final Battle" },
      }).infoItems,
    ).to.deep.equal([
      { symbol: "book.fill", text: "Ch. 113" },
      { symbol: "star.fill", text: "5" },
    ]);
    expect(
      toFeaturedItem({
        ...base,
        chapter: { chapterId: "notice-s3-info", title: "Notice: Season 3 Info" },
      }).infoItems,
    ).to.deep.equal([{ symbol: "star.fill", text: "5" }]);
  });

  await suite.run();
}
