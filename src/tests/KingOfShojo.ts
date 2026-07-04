import { type TestLogger } from "@paperback/types";

import { KingOfShojo } from "../KingOfShojo/main.js";
import sourceInfo from "../KingOfShojo/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("KingOfShojo tests", logger);
  registerDefaultTests(suite, KingOfShojo, sourceInfo);

  await suite.run();
}
