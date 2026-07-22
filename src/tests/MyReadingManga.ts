import { type TestLogger } from "@paperback/types";

import { MyReadingManga } from "../MyReadingManga/main.js";
import sourceInfo from "../MyReadingManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MyReadingManga tests", logger);
  registerDefaultTests(suite, MyReadingManga, sourceInfo);

  await suite.run();
}
