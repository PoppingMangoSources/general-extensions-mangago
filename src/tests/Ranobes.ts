import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { buildFilterPath, Ranobes } from "../Ranobes/main.js";
import {
  parseChapterDetails,
  parseChapters,
  parseFilterTaxonomy,
  parseLatestUpdates,
  parseListings,
  toFeaturedItem,
  toRankingItem,
} from "../Ranobes/parsers.js";
import sourceInfo from "../Ranobes/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Ranobes tests", logger);
  registerDefaultTests(suite, Ranobes, sourceInfo, {
    searchResultsProviding: false,
    mangaProviding: false,
    chapterProviding: false,
  });

  suite.test("discover sections expose the requested novel feeds", async () => {
    const sections = await Ranobes.getDiscoverSections();
    expect(sections.map((section) => section.title)).to.deep.equal([
      "Featured",
      "Latest Updates",
      "Most Viewed Novels",
      "Most Rated Novels",
      "All Time Popular",
    ]);
  });

  suite.test("live discover pages return cards from every requested feed", async () => {
    const sections = await Ranobes.getDiscoverSections();
    for (const section of sections) {
      const result = await Ranobes.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.title).to.be.greaterThan(0);
      expect(
        result.items.every((item) => !("imageUrl" in item) || item.imageUrl.startsWith("https://")),
        `${section.title} images`,
      ).to.equal(true);
    }
  });

  suite.test("live details, chapters, and HTML reader work end to end", async () => {
    const manga = await Ranobes.getMangaDetails(
      "https://ranobes.net/novels/1207185-the-sword-illuminates-the-great-wilderness.html",
    );
    expect(manga.mangaInfo.contentType).to.equal("novel");
    expect(manga.mangaInfo.thumbnailUrl).to.match(/^https:\/\/ranobes\.net\//);

    const chapters = await Ranobes.getChapters(manga);
    expect(chapters.length).to.be.greaterThan(0);
    const details = await Ranobes.getChapterDetails(chapters[0]);
    expect(details.type).to.equal("html");
    expect(details.type === "html" ? details.html : "").to.include("<body>");
  });

  suite.test("advanced search exposes valid IDs and all filter parameters", async () => {
    const taxonomy = parseFilterTaxonomy(`
      <select name="n.genre"><option value="Gender Bender">Gender Bender</option></select>
      <select name="n.events"><option value="Akame ga Kill!">Akame ga Kill!</option></select>
    `);
    expect(taxonomy).to.deep.equal({
      genres: [{ id: "Gender%20Bender", title: "Gender Bender" }],
      events: [{ id: "Akame%20ga%20Kill%21", title: "Akame ga Kill!" }],
    });
    expect(
      buildFilterPath(
        "Reincarnation",
        {
          genres: { "Gender%20Bender": "included" },
          events: { Thriller: "excluded" },
          languages: { English: "included", Korean: "excluded" },
          yearFrom: "1990",
          yearTo: "2026",
          translationStatus: "Active",
          originalStatus: "Ongoing",
          chaptersFrom: "50",
          chaptersTo: "12000",
          ratingsFrom: "1",
          ratingsTo: "1000",
          authors: "Get Lost",
          excludedAuthors: "Young Master Yan",
          translators: "CKtalon",
          excludedTranslators: "Machine translate",
          publishers: "Qidian",
          excludedPublishers: "Webnovel",
          onlyTranslated: true,
          mtlFiles: true,
          mtlReader: true,
          aiTranslated: true,
        },
        { id: "views_desc", label: "Views" },
      ),
    ).to.include(
      "/f/l.title=Reincarnation/n.genre=Gender+Bender/v.events=Thriller/b.languages=English/v.languages=Korean/",
    );
  });

  suite.test("live advanced search loads the full taxonomy", async () => {
    const form = await Ranobes.getAdvancedSearchForm({ title: "" });
    expect(form.getSections().length).to.equal(11);
  });

  suite.test("featured cards retain rating, description, and views", async () => {
    const cards = parseListings(
      `
      <article class="block story shortstory">
        <h2 class="title"><a href="/novels/1-demo.html">Demo Novel</a></h2>
        <figure class="cover" style="background-image:url('/cover.jpg')"></figure>
        <div class="cont-in"><div style="color:red">A short description.</div></div>
        <div class="r-rate"><span class="grey"><a>Fantasy</a></span></div>
        <div class="r-date"><span class="rate-drop"><strong>4.6</strong></span><span id="vote-num-id-1">(12)</span></div>
        <span class="meta_author" title="Unique views: 1 234"></span>
      </article>
    `,
      "stories",
    );
    const [item] = cards.map(toFeaturedItem);
    expect(item).to.include({
      type: "featuredCarouselItem",
      title: "Demo Novel",
      summary: "A short description.",
    });
    expect(item.type === "featuredCarouselItem" ? item.infoItems : undefined).to.deep.equal([
      { symbol: "star.fill", text: "4.6 (12)" },
      { symbol: "eye.fill", text: "1,234" },
    ]);
  });

  suite.test("latest updates expose chapter titles and timestamps", async () => {
    const items = parseLatestUpdates(`
      <div class="block story_line story_line-img">
        <a href="/demo-novel-1/123.html"><i class="image cover" style="background-image:url('/cover.jpg')"></i></a>
        <h3 class="title">Demo Novel</h3><span class="subtitle">Chapter 9</span><em>2 hours ago</em>
      </div>
    `);
    expect(items[0]).to.include({
      type: "chapterUpdatesCarouselItem",
      title: "Demo Novel",
      subtitle: "Chapter 9",
      chapterId: "https://ranobes.net/demo-novel-1/123.html",
    });
    expect(
      items[0].type === "chapterUpdatesCarouselItem" ? items[0].publishDate : undefined,
    ).to.be.instanceOf(Date);
  });

  suite.test("ranking cards preserve order and expose the correct ranking metric", async () => {
    const html = [1, 2]
      .map(
        (rank) => `
          <article class="rank-story">
            <figure class="fit-cover"><img src="/cover-${rank}.jpg"></figure>
            <h2 class="title"><a href="/novels/${rank}-demo-${rank}.html">Demo ${rank}</a></h2>
            <div class="rank-story-data"><i class="fa-eye"></i><span class="rank-story-data-val">${rank} 000</span></div>
          </article>
        `,
      )
      .join("");
    const items = parseListings(html, "rankings").map((card, index) =>
      toRankingItem(card, index, false),
    );
    expect(items.map((item) => item.subtitle)).to.deep.equal([
      "#1 • 1,000 views",
      "#2 • 2,000 views",
    ]);
  });

  suite.test("chapter pages return HTML and omit executable content", async () => {
    const sourceManga = {
      mangaId: "https://ranobes.net/novels/1-demo.html",
      mangaInfo: { primaryTitle: "Demo", thumbnailUrl: "https://ranobes.net/cover.jpg" },
    };
    const [chapter] = parseChapters(
      [
        {
          chapters: [
            { id: "1", title: "Chapter 1", date: "2026-07-23 06:24:40", link: "/demo-1/1.html" },
          ],
        },
      ],
      sourceManga,
    );
    const details = parseChapterDetails(
      `<div id="arrticle"><p>Hello</p><script>alert(1)</script></div>`,
      chapter,
    );
    expect(details).to.include({ type: "html", id: chapter.chapterId });
    expect(details.type === "html" ? details.html : "").to.include("Hello");
    expect(details.type === "html" ? details.html : "").not.to.include("alert");
  });

  await suite.run();
}
