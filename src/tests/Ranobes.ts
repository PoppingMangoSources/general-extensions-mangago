import { type TestLogger } from "@paperback/types";

import { Ranobes } from "../Ranobes/main.js";
import sourceInfo from "../Ranobes/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Ranobes tests", logger);
  registerDefaultTests(suite, Ranobes, sourceInfo);

  await suite.run();
}
