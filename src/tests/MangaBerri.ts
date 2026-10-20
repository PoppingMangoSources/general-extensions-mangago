import { type TestLogger } from "@paperback/types";

import { MangaBerri } from "../MangaBerri/main.js";
import sourceInfo from "../MangaBerri/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaBerri tests", logger);
  registerDefaultTests(suite, MangaBerri, sourceInfo);
  await suite.run();
}
