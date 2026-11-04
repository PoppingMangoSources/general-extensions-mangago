import { type TestLogger } from "@paperback/types";

import { Swarm } from "../Swarm/main.js";
import sourceInfo from "../Swarm/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Swarm tests", logger);

  registerDefaultTests(suite, Swarm, sourceInfo);

  await suite.run();
}
