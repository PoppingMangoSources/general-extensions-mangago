import { type TestLogger } from "@paperback/types";

import { ScansGG } from "../ScansGG/main.js";
import sourceInfo from "../ScansGG/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ScansGG tests", logger);
  registerDefaultTests(suite, ScansGG, sourceInfo);

  await suite.run();
}
