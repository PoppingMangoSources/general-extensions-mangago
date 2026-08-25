import { type TestLogger } from "@paperback/types";
import { DiscoverSectionType } from "@paperback/types";
import { expect } from "chai";

import { getDomain } from "../OManga/forms/settings.js";
import { OManga, OMangaExtension } from "../OManga/main.js";
import { parseCoverUrl, parseHomeLinkSection, parseSeriesProps } from "../OManga/parsers.js";
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
    Object.defineProperty(extension, "homepagePromise", {
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
    Object.defineProperty(extension, "homepagePromise", {
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

  suite.test("series covers resolve from Flight image preloads", async () => {
    const covers = [
      "https://opics.online/media/covers/l-/l-YrkWNQ1etfOuO-KsOTU6BPbWOQMyfiKaMSm77dI9o.webp",
      "https://opics.online/media/covers/P6/P6oZDxf0GKVNjem9c-pLD4JRZ_HpWpFzWR20gak1VtY.webp",
      "https://opics.online/media/covers/XR/XRRfrpUQqNQ_IhHthY0K9HfF74fa6vjvZZ5DlpNNW4Y.webp",
      "https://opics.online/media/covers/j0/j05W7uhnPJGTpdR-i81I2U4Rdc6daSKRcSHZHGoM8e0.webp",
    ];

    for (const cover of covers) {
      const preload = `:HL["${cover}","image",{"fetchPriority":"high"}]`;
      const html = `<script>self.__next_f.push([1,${JSON.stringify(preload)}])</script>`;
      expect(parseCoverUrl(html)).to.equal(cover);
    }
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

  suite.test("genre match uses full-width AND/OR controls", async () => {
    const form = await OManga.getAdvancedSearchForm({ title: "", metadata: { genreStrict: true } });
    const section = form.getSections().find((candidate) => candidate.id === "genre_match");
    expect(section?.type).to.equal("flowSection");
    expect(section?.items.map((item) => item.id)).to.deep.equal(["and", "or"]);
    expect(form.getSearchQueryMetadata()).to.deep.include({ genreStrict: true });
  });

  registerDefaultTests(suite, OManga, sourceInfo);

  await suite.run();
}
