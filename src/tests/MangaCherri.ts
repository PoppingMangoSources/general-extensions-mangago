import { type TestLogger } from "@paperback/types";

import { MangaCherri } from "../MangaCherri/main.js";
import sourceInfo from "../MangaCherri/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaCherri tests", logger);
  registerDefaultTests(suite, MangaCherri, sourceInfo);
  await suite.run();
}
