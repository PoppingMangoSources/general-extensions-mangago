import { type TestLogger } from "@paperback/types";

import { HiveScans } from "../HiveScans/main.js";
import sourceInfo from "../HiveScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("HiveScans tests", logger);
  registerDefaultTests(suite, HiveScans, sourceInfo);

  await suite.run();
}
