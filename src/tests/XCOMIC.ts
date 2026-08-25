import { type TestLogger } from "@paperback/types";

import { XCOMIC } from "../XCOMIC/main.js";
import sourceInfo from "../XCOMIC/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("XCOMIC tests", logger);

  registerDefaultTests(suite, XCOMIC, sourceInfo);

  await suite.run();
}
