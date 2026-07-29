import { type TestLogger } from "@paperback/types";

import { MVLEMPYR } from "../MVLEMPYR/main.js";
import sourceInfo from "../MVLEMPYR/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MVLEMPYR tests", logger);
  registerDefaultTests(suite, MVLEMPYR, sourceInfo);

  await suite.run();
}
