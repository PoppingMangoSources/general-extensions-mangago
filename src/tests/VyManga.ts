import { type TestLogger } from "@paperback/types";

import { VyManga } from "../VyManga/main.js";
import sourceInfo from "../VyManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("VyManga tests", logger);
  registerDefaultTests(suite, VyManga, sourceInfo);

  await suite.run();
}
