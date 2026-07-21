import { type TestLogger } from "@paperback/types";

import { RokariComics } from "../RokariComics/main.js";
import sourceInfo from "../RokariComics/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("RokariComics tests", logger);
  registerDefaultTests(suite, RokariComics, sourceInfo);

  await suite.run();
}
