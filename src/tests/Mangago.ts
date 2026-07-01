/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type TestLogger } from "@paperback/types";

import { Mangago } from "../Mangago/main.js";
import sourceInfo from "../Mangago/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Mangago tests", logger);
  registerDefaultTests(suite, Mangago, sourceInfo);

  await suite.run();
}
