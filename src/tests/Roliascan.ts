import { type TestLogger } from "@paperback/types";

import { Roliascan } from "../Roliascan/main.js";
import sourceInfo from "../Roliascan/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Roliascan tests", logger);
  registerDefaultTests(suite, Roliascan, sourceInfo);

  await suite.run();
}
