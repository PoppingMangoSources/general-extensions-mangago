import { type TestLogger } from "@paperback/types";

import { BunManga } from "../BunManga/main";
import sourceInfo from "../BunManga/pbconfig";
import { TestSuite, registerDefaultTests } from "./suite";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("BunManga tests", logger);
  registerDefaultTests(suite, BunManga, sourceInfo);
  await suite.run();
}
