import { type TestLogger } from "@paperback/types";

import { LuaComic } from "../LuaComic/main.js";
import sourceInfo from "../LuaComic/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("LuaComic tests", logger);
  registerDefaultTests(suite, LuaComic, sourceInfo);

  await suite.run();
}
