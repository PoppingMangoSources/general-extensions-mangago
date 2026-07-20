import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { OManga } from "../OManga/main.js";
import sourceInfo from "../OManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("oManga tests", logger);
  registerDefaultTests(suite, OManga, sourceInfo, {
    mangaProviding: { getMangaDetails: ["renai-catalog"] },
  });

  suite.test("discover sections", async () => {
    const sections = await OManga.getDiscoverSections();
    const updatesSection = sections.find((section) => section.id === "updates");
    const genresSection = sections.find((section) => section.id === "genres");

    expect(updatesSection).not.equal(undefined);
    expect(genresSection).not.equal(undefined);
    if (!updatesSection || !genresSection) throw new Error("Missing discover sections");

    const updates = await OManga.getDiscoverSectionItems(updatesSection, undefined);
    const genres = await OManga.getDiscoverSectionItems(genresSection, undefined);
    expect(updates.items.length).greaterThan(0);
    expect(genres.items.length).greaterThan(0);
  });

  suite.test("search and settings forms", async () => {
    const searchForm = await OManga.getAdvancedSearchForm({ title: "" });
    const settingsForm = await OManga.getSettingsForm();

    expect(searchForm.getSections().length).greaterThan(0);
    expect(settingsForm.getSections().length).greaterThan(0);
  });

  await suite.run();
}
