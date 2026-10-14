import { type TestLogger } from "@paperback/types";

import { ToonkotsuSortCheck } from "../ToonkotsuSortCheck/main.js";
import sourceInfo from "../ToonkotsuSortCheck/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("ToonkotsuSortCheck tests", logger);
  registerDefaultTests(suite, ToonkotsuSortCheck, sourceInfo);

  await suite.run();
}
