import { type TestLogger } from "@paperback/types";

import { KaliScan } from "../KaliScan/main.js";
import sourceInfo from "../KaliScan/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("KaliScan tests", logger);
  registerDefaultTests(suite, KaliScan, sourceInfo);

  await suite.run();
}
