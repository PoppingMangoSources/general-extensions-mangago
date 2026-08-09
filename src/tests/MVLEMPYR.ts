import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MVLEMPYR } from "../MVLEMPYR/main.js";
import sourceInfo from "../MVLEMPYR/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MVLEMPYR tests", logger);
  registerDefaultTests(suite, MVLEMPYR, sourceInfo);

  suite.test("genre match uses full-width AND/OR controls", async () => {
    const form = await MVLEMPYR.getAdvancedSearchForm({
      title: "",
      metadata: { genreMatch: ["or"] },
    });
    const section = form.getSections().find((candidate) => candidate.id === "genre_match");
    expect(section?.type).to.equal("flowSection");
    expect(section?.items.map((item) => item.id)).to.deep.equal(["and", "or"]);
    expect(form.getSearchQueryMetadata()).to.deep.include({ genreMatch: ["or"] });
  });

  await suite.run();
}
