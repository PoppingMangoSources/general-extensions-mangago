import assert from "node:assert/strict";
import test from "node:test";

import { summarize } from "../check-tests.mjs";

const pass = {
  tests: [{ name: "getSearchResults", status: "pass", duration: 3 }],
  summary: { failed: false },
};

void test("a passing report has no problems", () => {
  assert.deepEqual(summarize({ Demo: pass }, ["Demo"]), { passed: 1, problems: [] });
});

void test("a failed test, a bundle error and a missing source are all problems", () => {
  const report = {
    Demo: {
      tests: [{ name: "getChapters", status: "fail", error: "HTTP 403" }],
      summary: { failed: true },
    },
    Broken: { error: "SyntaxError: bad bundle" },
  };
  const { problems } = summarize(report, ["Demo", "Broken", "Missing"]);
  assert.equal(problems.length, 3);
  assert.ok(problems.some((p) => p.includes("Missing")));
  assert.ok(problems.some((p) => p.includes("HTTP 403")));
});

void test("a source that ran no tests is a problem", () => {
  assert.equal(summarize({ Demo: { tests: [] } }).problems.length, 1);
});
