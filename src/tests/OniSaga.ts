import { type TestLogger } from "@paperback/types";

import { OniSaga } from "../OniSaga/main.js";
import sourceInfo from "../OniSaga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("OniSaga tests", logger);
  registerDefaultTests(suite, OniSaga, sourceInfo);

  await suite.run();
}
