import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { TempleScan } from "../TempleScan/main.js";
import { toFeaturedItems, withFeaturedCovers } from "../TempleScan/parsers.js";
import sourceInfo from "../TempleScan/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("TempleScan tests", logger);
  registerDefaultTests(suite, TempleScan, sourceInfo);

  suite.test("featured cards prefer portrait covers", () => {
    const [item] = toFeaturedItems([
      {
        series_slug: "cover-test",
        title: "Cover Test",
        thumbnail: "https://example.com/cover.webp",
        banner: "https://example.com/banner.webp",
      },
    ]);

    expect(item).to.include({
      type: "featuredCarouselItem",
      imageUrl: "https://example.com/cover.webp",
    });
  });

  suite.test("featured covers join by exact slug", () => {
    const entries = withFeaturedCovers(
      [
        {
          series_slug: "second",
          title: "Second",
          banner: "https://example.com/second-banner.webp",
        },
        {
          series_slug: "first",
          title: "First",
          banner: "https://example.com/first-banner.webp",
        },
      ],
      [
        { series_slug: "first", title: "First", thumbnail: "https://example.com/first.webp" },
        {
          series_slug: "second",
          title: "Second",
          thumbnail: "https://example.com/second.webp",
        },
      ],
    );

    expect(entries.map((entry) => entry.thumbnail)).to.deep.equal([
      "https://example.com/second.webp",
      "https://example.com/first.webp",
    ]);
  });

  suite.test("featured covers replace the two unreliable ImageShack assets", () => {
    const entries = withFeaturedCovers(
      [
        { series_slug: "i-thought-its-a-common-possession", title: "Possession" },
        { series_slug: "the-law-of-being-friends-with-a-male", title: "Friends" },
      ],
      [
        {
          series_slug: "i-thought-its-a-common-possession",
          title: "Possession",
          thumbnail: "https://imagizer.imageshack.com/broken-one.jpg",
        },
        {
          series_slug: "the-law-of-being-friends-with-a-male",
          title: "Friends",
          thumbnail: "https://imagizer.imageshack.com/broken-two.png",
        },
      ],
    );

    expect(
      entries.every((entry) => entry.thumbnail?.startsWith("https://uploads.mangadex.org/")),
    ).to.equal(true);
  });

  suite.test("featured cards never fall back to wide banners", () => {
    const [item] = toFeaturedItems([
      {
        series_slug: "fallback-test",
        title: "Fallback Test",
        protagonist: "https://example.com/title-art.webp",
        banner: "https://example.com/wide-banner.webp",
      },
    ]);

    expect(item).to.include({ imageUrl: "https://example.com/title-art.webp" });
  });

  suite.test("discover sections match the site", async () => {
    const sections = await TempleScan.getDiscoverSections();
    expect(sections.map((section) => section.title)).to.deep.equal([
      "Featured",
      "New Series",
      "Latest Updates",
      "Trending",
    ]);

    const featured = await TempleScan.getDiscoverSectionItems(sections[0], undefined);
    expect(featured.items.length).to.be.greaterThan(0);
    expect(featured.items.every((item) => item.type === "featuredCarouselItem")).to.equal(true);
    expect(
      featured.items.every(
        (item) => item.type === "featuredCarouselItem" && !!item.imageUrl && !!item.summary,
      ),
    ).to.equal(true);
    expect(new Set(featured.items.map((item) => item.imageUrl)).size).to.equal(
      featured.items.length,
    );

    const trending = await TempleScan.getDiscoverSectionItems(sections[3], undefined);
    const chips = trending.items.filter((item) => item.type === "genresCarouselItem");
    expect(chips.map((chip) => chip.name)).to.deep.equal(["Today", "This Week", "Monthly"]);
    for (const chip of chips) {
      const results = await TempleScan.getSearchResults(chip.searchQuery, undefined);
      expect(results.items.length).to.be.greaterThan(0);
    }
  });

  await suite.run();
}
