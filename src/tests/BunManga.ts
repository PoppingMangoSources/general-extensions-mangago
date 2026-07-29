import type { TestLogger } from "@paperback/types";

import { BunManga } from "../BunManga/main.js";
import sourceInfo from "../BunManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("BunManga tests", logger);
  registerDefaultTests(suite, BunManga, sourceInfo);

  await suite.run();
}
