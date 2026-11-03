import { type TestLogger } from "@paperback/types";

import { Chikari } from "../Chikari/main.js";
import sourceInfo from "../Chikari/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Chikari tests", logger);
  registerDefaultTests(suite, Chikari, sourceInfo);

  await suite.run();
}
