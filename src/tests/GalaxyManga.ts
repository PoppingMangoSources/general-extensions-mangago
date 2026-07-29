import { type TestLogger } from "@paperback/types";

import { GalaxyManga } from "../GalaxyManga/main.js";
import sourceInfo from "../GalaxyManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("GalaxyManga tests", logger);
  registerDefaultTests(suite, GalaxyManga, sourceInfo);

  await suite.run();
}
