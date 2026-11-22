import { type TestLogger } from "@paperback/types";

import { Cocomic } from "../Cocomic/main.js";
import sourceInfo from "../Cocomic/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Cocomic tests", logger);
  registerDefaultTests(suite, Cocomic, sourceInfo);
  await suite.run();
}
