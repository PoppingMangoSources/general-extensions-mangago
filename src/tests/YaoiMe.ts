import { type TestLogger } from "@paperback/types";

import { YaoiMe } from "../YaoiMe/main.js";
import sourceInfo from "../YaoiMe/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("YaoiMe tests", logger);
  registerDefaultTests(suite, YaoiMe, sourceInfo);

  await suite.run();
}
