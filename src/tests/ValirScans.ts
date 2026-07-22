import { type TestLogger } from "@paperback/types";

import { ValirScans } from "../ValirScans/main.js";
import sourceInfo from "../ValirScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ValirScans tests", logger);
  registerDefaultTests(suite, ValirScans, sourceInfo);

  await suite.run();
}
