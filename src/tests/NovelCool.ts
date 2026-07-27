import { type TestLogger } from "@paperback/types";

import { NovelCool } from "../NovelCool/main.js";
import sourceInfo from "../NovelCool/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("NovelCool tests", logger);
  registerDefaultTests(suite, NovelCool, sourceInfo);

  await suite.run();
}
