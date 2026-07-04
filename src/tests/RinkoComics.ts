import { type TestLogger } from "@paperback/types";

import { RinkoComics } from "../RinkoComics/main.js";
import sourceInfo from "../RinkoComics/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("RinkoComics tests", logger);
  registerDefaultTests(suite, RinkoComics, sourceInfo);

  await suite.run();
}
