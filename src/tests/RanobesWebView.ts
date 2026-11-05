import { type TestLogger } from "@paperback/types";

import { RanobesWebView } from "../RanobesWebView/main.js";
import sourceInfo from "../RanobesWebView/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("RanobesWebView tests", logger);

  registerDefaultTests(suite, RanobesWebView, sourceInfo);

  await suite.run();
}
