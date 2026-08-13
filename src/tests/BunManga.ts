import { DiscoverSectionType, type TestLogger } from "@paperback/types";
import { expect } from "chai";
import * as cheerio from "cheerio";

import { BunManga } from "../BunManga/main.js";
import { SECTIONS } from "../BunManga/models.js";
import { parsePopular } from "../BunManga/parsers.js";
import sourceInfo from "../BunManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("BunManga tests", logger);
  registerDefaultTests(suite, BunManga, sourceInfo);

  suite.test("Popular follows the homepage slider", async () => {
    const expected = parsePopular(
      cheerio.load(`
        <div class="widget-manga-popular-slider">
          <h5 class="heading">POPULAR</h5>
          <div class="slider__item">
            <div class="slider__thumb"><img src="https://bunmanga.com/popular.jpg" /></div>
            <div class="post-title"><a href="/manga/site-popular/">Site Popular</a></div>
            <div class="chapter-item"><span class="chapter"><a href="/manga/site-popular/chap-10/">Chap 10</a></span></div>
          </div>
        </div>
        <div class="widget-manga-recent">
          <h5 class="heading">TOP DAILY</h5>
          <div class="popular-item-wrap">
            <div class="widget-title"><a href="/manga/top-daily/">Top Daily</a></div>
          </div>
        </div>
      `),
    );
    expect(expected.map((item) => item.title)).to.deep.equal(["Site Popular"]);
    const result = await BunManga.getDiscoverSectionItems(
      { id: SECTIONS.POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      undefined,
    );
    expect(result.items.length).to.be.greaterThan(0);
  });

  await suite.run();
}
