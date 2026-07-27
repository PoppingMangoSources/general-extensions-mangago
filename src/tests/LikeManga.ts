import type { TestLogger } from "@paperback/types";

import { LikeManga } from "../LikeManga/main.js";
import sourceInfo from "../LikeManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LikeManga tests", logger);
  registerDefaultTests(suite, LikeManga, sourceInfo);

  await suite.run();
}
