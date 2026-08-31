import { type TestLogger } from "@paperback/types";

import { VioletScans } from "../VioletScans/main.js";
import sourceInfo from "../VioletScans/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("VioletScans tests", logger);
  registerDefaultTests(suite, VioletScans, sourceInfo);

  await suite.run();
}
