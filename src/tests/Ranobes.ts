import { SourceIntents, type TestLogger } from "@paperback/types";
import { expect } from "chai";
import * as cheerio from "cheerio";

import { Ranobes } from "../Ranobes/main.js";
import { FILTER_TAXONOMY_STATE } from "../Ranobes/models.js";
import { buildSearchPath, toFilterOptionId } from "../Ranobes/network.js";
import {
  isLastListingPage,
  parseChapterDetails,
  parseChapterPage,
  parseChapters,
  parseFilterTaxonomy,
  parseListings,
  parseMangaDetails,
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

  suite.test("manifest exposes novel features without Cloudflare bypass", async () => {
    expect(sourceInfo.capabilities).to.include.members([
      SourceIntents.CHAPTER_PROVIDING,
      SourceIntents.DISCOVER_SECTION_PROVIDING,
      SourceIntents.SEARCH_RESULT_PROVIDING,
    ]);
    expect(sourceInfo.capabilities).not.to.include(SourceIntents.CLOUDFLARE_BYPASS_PROVIDING);
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

  suite.test("live Discover sections return cards", async () => {
    const sections = await Ranobes.getDiscoverSections();
    for (const section of sections) {
      const result = await Ranobes.getDiscoverSectionItems(section, undefined);
      expect(result.items.length, section.title).to.be.greaterThan(0);
      for (const item of result.items) {
        if ("mangaId" in item) {
          expect(item.mangaId, section.title).to.match(/^https:\/\/ranobes\.net\//);
          expect(item.title, section.title).not.to.equal("");
        }
      }
    }
  });

  suite.test("live chapter loading is complete and newest-first", async () => {
    const sourceManga = await Ranobes.getMangaDetails(
      "https://ranobes.net/novels/1207185-the-sword-illuminates-the-great-wilderness.html",
    );
    const chapters = await Ranobes.getChapters(sourceManga);
    expect(chapters.length).to.be.greaterThan(25);
    expect(chapters[0].chapNum).to.be.greaterThan(chapters.at(-1)?.chapNum ?? 0);
    expect(chapters.map((chapter) => chapter.sortingIndex)).to.deep.equal(
      chapters.map((_, index) => index),
    );
    const details = await Ranobes.getChapterDetails(chapters[0]);
    expect(details.type).to.equal("html");
    expect(details.type === "html" ? details.html.length : 0).to.be.greaterThan(100);
  });

  suite.test("live text search returns novel cards", async () => {
    const result = await Ranobes.getSearchResults({ title: "Radiant Blade" }, undefined, {
      id: "rating",
      label: "Rating",
    });
    expect(result.items.length).to.be.greaterThan(0);
    expect(result.items.some((item) => item.title.includes("Radiant Blade"))).to.equal(true);
  });

  suite.test("live advanced search replaces invalid cached option IDs", async () => {
    Application.setState(
      {
        genres: [{ id: "Gender Bender", title: "Gender Bender" }],
        events: [{ id: "Girl's%20Love", title: "Girl's Love" }],
      },
      FILTER_TAXONOMY_STATE,
    );
    const form = await Ranobes.getAdvancedSearchForm({ title: "" });
    expect(form.getSections()).to.have.length(11);
  });

  suite.test("advanced search IDs are valid and reversible", async () => {
    const taxonomy = parseFilterTaxonomy(
      cheerio.load(`
        <div class="cat_block">
          <a href="/tags/events/Akame%20ga%20Kill!/"><h3>Akame ga Kill!</h3></a>
        </div>
        <div class="cat_block">
          <a href="/tags/events/Girl's%20Love%20-%20Subplot/">
            <h3>Girl's Love - Subplot</h3>
          </a>
        </div>
      `),
    );
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
      buildSearchPath(
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
    const page = parseChapterPage(
      cheerio.load(`
        <script>
          window.__DATA__ = {
            "chapters":[{"id":"4","title":"Chapter 4: Finale","link":"/demo-1/4.html"}],
            "pages_count":41,
            "count_all":1013,
            "limit":25
          };
        </script>
      `),
    );
    expect(page).to.include({ pages_count: 41, count_all: 1013, limit: 25 });
    expect(page.chapters?.[0].title).to.equal("Chapter 4: Finale");
  });

  suite.test("listing pagination stops on the final page", async () => {
    expect(
      isLastListingPage(
        cheerio.load(`
          <div class="navigation">
            <span class="page_next"><a href="/novels/page/2/">Next</a></span>
            <div class="pages"><span>1</span><a href="/novels/page/2/">2</a></div>
          </div>
        `),
      ),
    ).to.equal(false);
    expect(
      isLastListingPage(
        cheerio.load(`
          <div class="navigation">
            <span class="page_next"></span>
            <div class="pages"><a href="/novels/">1</a><span>2</span></div>
          </div>
        `),
      ),
    ).to.equal(true);
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
    expect(chapters.map((chapter) => chapter.sortingIndex)).to.deep.equal([0, 1, 2, 3]);
    expect(chapters.map((chapter) => chapter.title)).to.deep.equal([
      "Finale",
      "Third",
      "Second",
      undefined,
    ]);
  });

  suite.test("one listing parser handles featured cards", async () => {
    const [listing] = parseListings(
      cheerio.load(`
        <article class="block story shortstory">
          <h2 class="title"><a href="/novels/1-demo.html">Demo Novel</a></h2>
          <figure class="cover" style="background-image:url('/cover.jpg')"></figure>
          <div class="cont-in"><div style="color:red">A short description.</div></div>
          <div class="r-rate"><span class="grey"><a>Fantasy</a></span></div>
          <div class="r-date">
            <span class="rate-drop"><strong>4.6</strong></span>
            <span id="vote-num-id-1">(12)</span>
          </div>
          <span class="meta_author" title="Unique views: 1 234"></span>
        </article>
      `),
      "stories",
    );
    expect(listing).to.include({
      title: "Demo Novel",
      description: "A short description.",
      rating: 4.6,
      ratingCount: 12,
      views: 1234,
    });
  });

  suite.test("one listing parser handles chapter updates", async () => {
    const [listing] = parseListings(
      cheerio.load(`
        <div class="block story_line story_line-img">
          <a href="/demo-novel-1/123.html">
            <i class="image cover" style="background-image:url('/cover.jpg')"></i>
          </a>
          <h3 class="title">Demo Novel</h3>
          <span class="subtitle">Chapter 9</span>
          <em>2 hours ago</em>
        </div>
      `),
      "updates",
    );
    expect(listing).to.include({
      title: "Demo Novel",
      chapterTitle: "Chapter 9",
      chapterId: "https://ranobes.net/demo-novel-1/123.html",
      mangaId: "https://ranobes.net/novels/1-demo-novel.html",
    });
    expect(listing.publishDate).to.be.instanceOf(Date);
  });

  suite.test("one listing parser handles ranking cards", async () => {
    const listings = parseListings(
      cheerio.load(
        [1, 2]
          .map(
            (rank) => `
              <article class="rank-story">
                <figure class="fit-cover"><img src="/cover-${rank}.jpg"></figure>
                <h2 class="title">
                  <a href="/novels/${rank}-demo-${rank}.html">Demo ${rank}</a>
                </h2>
                <div class="rank-story-data">
                  <i class="fa-eye"></i>
                  <span class="rank-story-data-val">${rank} 000</span>
                </div>
              </article>
            `,
          )
          .join(""),
      ),
      "rankings",
    );
    expect(listings.map((listing) => listing.views)).to.deep.equal([1000, 2000]);
  });

  suite.test("novel details expose Paperback novel metadata", async () => {
    const manga = parseMangaDetails(
      cheerio.load(`
        <h1 class="title">Demo Novel <span class="subtitle">Demo Alt</span></h1>
        <div class="r-fullstory-poster">
          <figure class="cover" style="background-image:url('/cover.jpg')"></figure>
        </div>
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
        <div id="mc-fs-rate">
          <div class="rate-stat-num"><span class="bold">4.5</span></div>
        </div>
      `),
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
            {
              id: "1",
              title: "Chapter 1",
              date: "2026-07-23 06:24:40",
              link: "/demo-1/1.html",
            },
          ],
        },
      ],
      sourceManga,
    );
    const details = parseChapterDetails(
      cheerio.load(
        `<div id="arrticle"><p>Hello</p><img src="/image.jpg"><script>alert(1)</script></div>`,
      ),
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
