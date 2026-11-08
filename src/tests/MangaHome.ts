import { type TestLogger } from "@paperback/types";

import { MangaHome } from "../MangaHome/main.js";
import sourceInfo from "../MangaHome/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaHome tests", logger);
  registerDefaultTests(suite, MangaHome, sourceInfo);

  await suite.run();
}
