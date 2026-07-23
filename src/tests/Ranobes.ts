import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { Ranobes } from "../Ranobes/main.js";
import {
  buildFilterPath,
  hasNextPage,
  parseChapterDetails,
  parseChapterPage,
  parseChapters,
  parseFilterTaxonomy,
  parseLatestUpdates,
  parseListings,
  parseMangaDetails,
  toFeaturedItem,
  toFilterOptionId,
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

  suite.test("advanced search IDs are valid and reversible", async () => {
    const taxonomy = parseFilterTaxonomy(`
      <select name="n.events">
        <option value="Akame ga Kill!">Akame ga Kill!</option>
        <option value="Girl's Love - Subplot">Girl's Love - Subplot</option>
      </select>
    `);
    expect(taxonomy.genres.length).to.be.greaterThan(30);
    expect(taxonomy.events.map((item) => item.title)).to.deep.equal([
      "Akame ga Kill!",
      "Girl's Love - Subplot",
    ]);
    for (const option of [...taxonomy.genres, ...taxonomy.events]) {
      expect(option.id, option.title).to.match(/^[A-Za-z0-9_]+$/);
    }

    const genderBender = taxonomy.genres.find((item) => item.title === "Gender Bender")?.id ?? "";
    const girlsLove = taxonomy.events[1].id;
    expect(
      buildFilterPath(
        "Reincarnation",
        {
          genres: { [genderBender]: "included" },
          events: { [girlsLove]: "excluded" },
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
      "/f/l.title=Reincarnation/n.genre=Gender+Bender/v.events=Girl's+Love+-+Subplot/b.languages=English/v.languages=Korean/",
    );
  });

  suite.test("chapter payloads parse their pagination contract", async () => {
    const page = parseChapterPage(`
      <script>
        window.__DATA__ = {
          "chapters":[{"id":"4","title":"Chapter 4: Finale","link":"/demo-1/4.html"}],
          "pages_count":41,
          "count_all":1013,
          "limit":25
        };
      </script>
    `);
    expect(page).to.include({ pages_count: 41, count_all: 1013, limit: 25 });
    expect(page.chapters?.[0].title).to.equal("Chapter 4: Finale");
  });

  suite.test("listing pagination stops on the final page", async () => {
    expect(
      hasNextPage(`
        <div class="navigation">
          <span class="page_next"><a href="/novels/page/2/">Next</a></span>
          <div class="pages"><span>1</span><a href="/novels/page/2/">2</a></div>
        </div>
      `),
    ).to.equal(true);
    expect(
      hasNextPage(`
        <div class="navigation">
          <span class="page_next"></span>
          <div class="pages"><a href="/novels/">1</a><span>2</span></div>
        </div>
      `),
    ).to.equal(false);
  });

  suite.test("chapters stay newest-first with clean titles and stable sorting", async () => {
    const sourceManga = {
      mangaId: "https://ranobes.net/novels/1-demo.html",
      mangaInfo: { primaryTitle: "Demo", thumbnailUrl: "https://ranobes.net/cover.jpg" },
    };
    const chapters = parseChapters(
      [
        {
          chapters: [
            {
              id: "4",
              title: "Chapter 4: Finale",
              date: "2026-07-23 06:24:40",
              link: "/demo-1/4.html",
            },
            {
              id: "3",
              title: "Chapter 3 - Third",
              date: "2026-07-22 06:24:40",
              link: "/demo-1/3.html",
            },
          ],
        },
        {
          chapters: [
            {
              id: "2",
              title: "Chapter 2: Second",
              date: "2026-07-21 06:24:40",
              link: "/demo-1/2.html",
            },
            {
              id: "1",
              title: "Chapter 1",
              date: "2026-07-20 06:24:40",
              link: "/demo-1/1.html",
            },
          ],
        },
      ],
      sourceManga,
    );
    expect(chapters.map((chapter) => chapter.chapNum)).to.deep.equal([4, 3, 2, 1]);
    expect(chapters.map((chapter) => chapter.sortingIndex)).to.deep.equal([4, 3, 2, 1]);
    expect(chapters.map((chapter) => chapter.title)).to.deep.equal([
      "Finale",
      "Third",
      "Second",
      undefined,
    ]);
  });

  suite.test("featured cards retain rating, description, and views", async () => {
    const [item] = parseListings(
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
    ).map(toFeaturedItem);
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
    const [item] = parseLatestUpdates(`
      <div class="block story_line story_line-img">
        <a href="/demo-novel-1/123.html"><i class="image cover" style="background-image:url('/cover.jpg')"></i></a>
        <h3 class="title">Demo Novel</h3><span class="subtitle">Chapter 9</span><em>2 hours ago</em>
      </div>
    `);
    expect(item).to.include({
      type: "chapterUpdatesCarouselItem",
      title: "Demo Novel",
      subtitle: "Chapter 9",
      chapterId: "https://ranobes.net/demo-novel-1/123.html",
    });
    expect(
      item.type === "chapterUpdatesCarouselItem" ? item.publishDate : undefined,
    ).to.be.instanceOf(Date);
  });

  suite.test("ranking cards preserve order and expose their metric", async () => {
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

  suite.test("novel details expose Paperback novel metadata", async () => {
    const manga = parseMangaDetails(
      `
        <h1 class="title">Demo Novel <span class="subtitle">Demo Alt</span></h1>
        <div class="r-fullstory-poster"><figure class="cover" style="background-image:url('/cover.jpg')"></figure></div>
        <div class="r-desription">
          <div class="cont-text">A demo synopsis.</div>
          <div class="grey"><a href="/tags/genre/fantasy/">Fantasy</a></div>
        </div>
        <ul class="r-fullstory-spec">
          <li>Authors: <a>Demo Author</a></li>
          <li>Language: <a>English</a></li>
          <li>Status in COO: <a>Ongoing</a></li>
          <li title="Unique views:"><span class="grey">1 234</span></li>
        </ul>
        <div id="mc-fs-rate"><div class="rate-stat-num"><span class="bold">4.5</span></div></div>
      `,
      "https://ranobes.net/novels/1-demo.html",
    );
    expect(manga.mangaInfo).to.include({
      primaryTitle: "Demo Novel",
      author: "Demo Author",
      contentType: "novel",
      status: "Ongoing",
    });
    expect(manga.mangaInfo.rating).to.equal(0.9);
  });

  suite.test("chapter pages return safe XHTML", async () => {
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
      `<div id="arrticle"><p>Hello</p><img src="/image.jpg"><script>alert(1)</script></div>`,
      chapter,
    );
    expect(details).to.include({ type: "html", id: chapter.chapterId });
    const html = details.type === "html" ? details.html : "";
    expect(html).to.include("https://ranobes.net/image.jpg");
    expect(html).to.match(/<img[^>]*\/>/);
    expect(html).not.to.include("alert");
  });

  suite.test("filter IDs remain self-sufficient for Unicode", async () => {
    expect(toFilterOptionId("女孩的爱")).to.match(/^[A-Za-z0-9_]+$/);
  });

  await suite.run();
}
