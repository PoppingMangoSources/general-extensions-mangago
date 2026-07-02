/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { OniSaga } from "../OniSaga/main.js";
import { getHeaderValue, getRetryDelayMs } from "../OniSaga/network.js";
import sourceInfo from "../OniSaga/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("OniSaga tests", logger);

  suite.test("reader retry helpers read headers case-insensitively", async () => {
    expect(getHeaderValue({ "X-Reader-Token": "abc" }, "x-reader-token")).to.equal("abc");
    expect(getHeaderValue({ "x-reader-token-next": "def" }, "X-Reader-Token-Next")).to.equal("def");
    expect(getRetryDelayMs({ "retry-after": "3" })).to.equal(3000);
    expect(getRetryDelayMs({})).to.equal(2500);
  });

  registerDefaultTests(suite, OniSaga, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
  });

  await suite.run();
}
