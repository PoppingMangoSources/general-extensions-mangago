import { type TestLogger } from "@paperback/types";

import { Toonkotsu } from "../Toonkotsu/main.js";
import sourceInfo from "../Toonkotsu/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Toonkotsu tests", logger);
  registerDefaultTests(suite, Toonkotsu, sourceInfo);

  await suite.run();
}
