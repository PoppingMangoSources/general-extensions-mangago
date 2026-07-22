import { type TestLogger } from "@paperback/types";
import { DiscoverSectionType } from "@paperback/types";
import { expect } from "chai";

import { OManga, OMangaExtension } from "../OManga/main.js";
import { getDomain } from "../OManga/models.js";
import { parseHomeLinkSection, parseSeriesProps } from "../OManga/parsers.js";
import sourceInfo from "../OManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("oManga tests", logger);

  suite.test("Popular returns all 17 homepage titles without genre summaries", async () => {
    const sections = await OManga.getDiscoverSections();
    const popular = sections.find((section) => section.title === "Popular");
    if (!popular) throw new Error("Popular section is missing");

    const popularItems = Array.from({ length: 17 }, (_, index) => ({
      id: index + 1,
      title: `Popular ${index + 1}`,
      slug: `popular-${index + 1}`,
      poster: `https://example.com/popular-${index + 1}.webp`,
      type: "Manhwa",
      year: 2026,
      genres: ["Action", "Fantasy"],
    }));
    const payload = `{"title":"Popular This Week","moreHref":"/manga","items":${JSON.stringify(popularItems)}}`;
    const extension = new OMangaExtension();
    Object.defineProperty(extension, "homepageRequest", {
      value: { domain: getDomain(), page: Promise.resolve(payload) },
      writable: true,
    });

    const results = await extension.getDiscoverSectionItems(popular, undefined);
    expect(results.items).to.have.length(17);
    expect(results.items[0]).to.include({
      type: "featuredCarouselItem",
      mangaId: "popular-1",
    });
    expect(results.items[16]).to.include({
      type: "featuredCarouselItem",
      mangaId: "popular-17",
    });
    expect(results.items.every((item) => !("summary" in item))).to.equal(true);
  });

  suite.test("Popular Today follows the trend section with prominent cards", async () => {
    const sections = await OManga.getDiscoverSections();
    const trendIndex = sections.findIndex((section) => section.title === "In the Trend");
    expect(sections[trendIndex + 1]).to.include({
      title: "Popular Today",
      type: DiscoverSectionType.prominentCarousel,
    });

    const payload = String.raw`
      ["$","p",null,{"children":"Popular Today"}],
      ["$","div",null,{"className":"hl-col-items","children":[
        ["$","a","1",{"href":"/manga/first","children":[
          ["$","img",null,{"src":"https://example.com/first.webp","alt":"First"}],
          ["$","p",null,{"className":"hl-card-sub","children":["Manhwa"," 2025"]}]
        ]}],
        ["$","a","2",{"href":"/manga/second","children":[
          ["$","img",null,{"src":"https://example.com/second.webp","alt":"Second"}],
          ["$","p",null,{"className":"hl-card-sub","children":["Manga"," 2024"]}]
        ]}]
      ]}]
    `;
    expect(parseHomeLinkSection(payload, "Popular Today", '"hl-col-items"')).to.deep.equal([
      {
        slug: "first",
        title: "First",
        cover: "https://example.com/first.webp",
        type: "Manhwa",
        year: "2025",
      },
      {
        slug: "second",
        title: "Second",
        cover: "https://example.com/second.webp",
        type: "Manga",
        year: "2024",
      },
    ]);

    const extension = new OMangaExtension();
    Object.defineProperty(extension, "homepageRequest", {
      value: { domain: getDomain(), page: Promise.resolve(payload) },
      writable: true,
    });
    const results = await extension.getDiscoverSectionItems(sections[trendIndex + 1], undefined);
    expect(results.items).to.have.length(2);
    expect(results.items[0]).to.include({
      type: "prominentCarouselItem",
      mangaId: "first",
      subtitle: "#1",
    });
    expect(results.items[1]).to.include({
      type: "prominentCarouselItem",
      mangaId: "second",
      subtitle: "#2",
    });
  });

  suite.test(
    "series descriptions resolve Flight text records only for exact references",
    async () => {
      const description = "From Kodansha:\nMagic is everywhere — 魔法.";
      const byteLength = new TextEncoder().encode(description).byteLength.toString(16);
      const referencedPayload =
        `0:{"initialTab":"info","mangaId":1,"slug":"witch-hat","title":"Witch Hat Atelier","description":"$99"}\n` +
        `99:T${byteLength},${description}\n`;
      expect(parseSeriesProps(referencedPayload, "witch-hat").description).to.equal(description);

      const literalPayload =
        '0:{"initialTab":"info","mangaId":2,"slug":"literal","title":"Literal","description":"Costs $99"}\n';
      expect(parseSeriesProps(literalPayload, "literal").description).to.equal("Costs $99");
    },
  );

  registerDefaultTests(suite, OManga, sourceInfo);

  await suite.run();
}
