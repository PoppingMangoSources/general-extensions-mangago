import { type TestLogger } from "@paperback/types";

import { OManga } from "../OManga/main.js";
import sourceInfo from "../OManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("oManga tests", logger);
  registerDefaultTests(suite, OManga, sourceInfo);

  await suite.run();
}
