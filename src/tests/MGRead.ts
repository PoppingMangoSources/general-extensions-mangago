import { type TestLogger } from "@paperback/types";

import { MGRead } from "../MGRead/main.js";
import sourceInfo from "../MGRead/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MGRead tests", logger);

  registerDefaultTests(suite, MGRead, sourceInfo);

  await suite.run();
}
