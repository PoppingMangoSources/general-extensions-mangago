import { type TestLogger } from "@paperback/types";

import { ReiManga } from "../ReiManga/main.js";
import sourceInfo from "../ReiManga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ReiManga tests", logger);
  registerDefaultTests(suite, ReiManga, sourceInfo);

  await suite.run();
}
