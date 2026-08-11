import { type Chapter, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { KaliScan } from "../KaliScan/main.js";
import { MIRRORS } from "../KaliScan/models.js";
import { completeMobileSafariUserAgent } from "../KaliScan/network.js";
import { parseCards, parseChapterPages, toLatestItems } from "../KaliScan/parsers.js";
import sourceInfo from "../KaliScan/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("KaliScan tests", logger);
  registerDefaultTests(suite, KaliScan, sourceInfo);

  suite.test("all shared mirrors remain selectable", async () => {
    expect(MIRRORS.map((mirror) => mirror.id)).to.deep.equal([
      "https://kaliscan.com",
      "https://kaliscan.me",
      "https://kaliscan.io",
      "https://mgjinx.com",
    ]);
  });

  suite.test("both listing card layouts produce stable update ids", async () => {
    const cards = parseCards(`
      <div class="book-item">
        <script id="json-data" type="application/json">{
          "name":"Mirror Title","url":"/manga/123-mirror-title","cover":"/cover.webp",
          "rating":"4.8","updated_at":"2026-08-10 12:00:00","is_adult":1,
          "genres":[{"name":"Drama"}]
        }</script>
        <a href="/manga/123-mirror-title"><img data-src="/cover.webp" /></a>
        <a href="/manga/123-mirror-title/chapter-4.5">Chapter 4.5</a>
      </div>
      <div class="book-detailed-item">
        <h3 class="title"><a href="/manga/456-second-title">Second Title</a></h3>
        <a class="latest-chapter" href="/manga/456-second-title/chapter-8">Chapter 8</a>
      </div>
    `);
    expect(cards.map((card) => card.title)).to.deep.equal(["Mirror Title", "Second Title"]);

    const updates = toLatestItems(cards);
    expect(updates.map((item) => item.mangaId)).to.deep.equal([
      "123-mirror-title",
      "456-second-title",
    ]);
    expect(updates.map((item) => ("chapterId" in item ? item.chapterId : undefined))).to.deep.equal(
      ["chapter-4.5", "chapter-8"],
    );
  });

  suite.test("reader accepts rendered and scripted image lists", async () => {
    const chapter = {
      chapterId: "chapter-1",
      sourceManga: { mangaId: "123-mirror-title" },
    } as Chapter;
    const rendered = parseChapterPages(
      '<img class="chapter-image" data-src="https://cdn.example/1.webp?sig=a&amp;b=2" />',
      chapter,
    );
    expect(rendered.pages).to.deep.equal(["https://cdn.example/1.webp?sig=a&b=2"]);

    const scripted = parseChapterPages(
      '<script>var mainServer="https://cdn.example"; var chapImages="/2.webp,/3.webp";</script>',
      chapter,
    );
    expect(scripted.pages).to.deep.equal([
      "https://cdn.example/2.webp",
      "https://cdn.example/3.webp",
    ]);
  });

  suite.test("Cloudflare requests use a complete mobile Safari identity", async () => {
    const bare =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
    const full = completeMobileSafariUserAgent(bare);
    expect(full).to.contain("Version/18.7 Mobile/15E148 Safari/604.1");
    expect(completeMobileSafariUserAgent(full)).to.equal(full);
  });

  await suite.run();
}
