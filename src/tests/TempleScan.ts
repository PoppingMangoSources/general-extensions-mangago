import { type TestLogger } from "@paperback/types";

import { TempleScan } from "../TempleScan/main.js";
import sourceInfo from "../TempleScan/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("TempleScan tests", logger);
  registerDefaultTests(suite, TempleScan, sourceInfo);

  await suite.run();
}
