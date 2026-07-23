import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { Ranobes } from "../Ranobes/main.js";
import {
  parseChapterDetails,
  parseChapters,
  parseFeatured,
  parseLatestUpdates,
  parseRankings,
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
      expect(result.items, section.title).not.empty;
    }
  });

  suite.test("featured cards retain rating, description, and views", async () => {
    const cards = parseFeatured(`
      <article class="block story shortstory">
        <h2 class="title"><a href="/novels/1-demo.html">Demo Novel</a></h2>
        <figure class="cover" style="background-image:url('/cover.jpg')"></figure>
        <div class="cont-in"><div style="color:red">A short description.</div></div>
        <div class="r-rate"><span class="grey"><a>Fantasy</a></span></div>
        <div class="r-date"><span class="rate-drop"><strong>4.6</strong></span><span id="vote-num-id-1">(12)</span></div>
        <span class="meta_author" title="Unique views: 1 234"></span>
      </article>
    `);
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
    const items = parseRankings(html).map((card, index) => toRankingItem(card, index, false));
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
