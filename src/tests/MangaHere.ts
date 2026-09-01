import { type TestLogger } from "@paperback/types";

import { MangaHere } from "../MangaHere/main.js";
import sourceInfo from "../MangaHere/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaHere tests", logger);
  registerDefaultTests(suite, MangaHere, sourceInfo, {
    mangaProviding: { getMangaDetails: ["tsugumomo"] },
  });

  await suite.run();
}
