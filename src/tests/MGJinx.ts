import { type TestLogger } from "@paperback/types";

import { MGJinx } from "../MGJinx/main.js";
import sourceInfo from "../MGJinx/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MGJinx tests", logger);
  registerDefaultTests(suite, MGJinx, sourceInfo);

  await suite.run();
}
