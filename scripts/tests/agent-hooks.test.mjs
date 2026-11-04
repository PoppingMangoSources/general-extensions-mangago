import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sourceOf, treeHash } from "../agent-hooks.mjs";

void test("sourceOf maps source files and their tests, not shared code", () => {
  assert.equal(sourceOf(path.join("src", "Demo", "forms", "search.ts")), "Demo");
  assert.equal(sourceOf(path.join("src", "tests", "Demo.ts")), "Demo");
  assert.equal(sourceOf(path.join("src", "utils", "state.ts")), undefined);
  assert.equal(sourceOf(path.join("scripts", "x.mjs")), undefined);
});

void test("treeHash changes when a source file or its test changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-"));
  fs.mkdirSync(path.join(root, "src/Demo"), { recursive: true });
  fs.mkdirSync(path.join(root, "src/tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/Demo/main.ts"), "a");
  fs.writeFileSync(path.join(root, "src/tests/Demo.ts"), "t");
  const first = treeHash(root, "Demo");
  assert.equal(treeHash(root, "Demo"), first);
  fs.writeFileSync(path.join(root, "src/tests/Demo.ts"), "t2");
  const second = treeHash(root, "Demo");
  assert.notEqual(second, first);
  fs.writeFileSync(path.join(root, "src/Demo/main.ts"), "b");
  assert.notEqual(treeHash(root, "Demo"), second);
});
