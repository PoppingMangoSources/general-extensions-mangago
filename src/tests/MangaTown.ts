import { type TestLogger } from "@paperback/types";

import { MangaTown } from "../MangaTown/main.js";
import sourceInfo from "../MangaTown/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaTown tests", logger);
  registerDefaultTests(suite, MangaTown, sourceInfo);

  await suite.run();
}
