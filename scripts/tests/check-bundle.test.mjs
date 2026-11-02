import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkBundle } from "../check-bundle.mjs";

function layout({
  info = { id: "Demo", icon: "icon.png", version: "1.0.0-alpha.1" },
  homepage = "paperback://addRepo paperback://installExtensions versioning.json",
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  for (const file of ["pbconfig.ts", "main.ts"]) {
    fs.mkdirSync(path.join(root, "src/Demo"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/Demo", file), "");
  }
  const bundle = path.join(root, "bundles");
  fs.mkdirSync(path.join(bundle, "Demo/static"), { recursive: true });
  fs.writeFileSync(path.join(bundle, "Demo/index.js"), "");
  fs.writeFileSync(path.join(bundle, "Demo/static/icon.png"), "");
  fs.writeFileSync(path.join(bundle, "Demo/info.json"), JSON.stringify(info));
  fs.writeFileSync(
    path.join(bundle, "versioning.json"),
    JSON.stringify({ builtWith: {}, sources: [info] }),
  );
  fs.writeFileSync(path.join(bundle, "index.html"), homepage);
  return { root, bundle };
}

void test("a complete bundle passes", () => {
  const { root, bundle } = layout();
  assert.deepEqual(checkBundle(bundle, { root }), []);
});

void test("a wrong id, a missing icon and a homepage without install links fail", () => {
  const { root, bundle } = layout({
    info: { id: "Other", icon: "logo.png", version: "1.0.0-alpha.1" },
    homepage: "<html></html>",
  });
  const problems = checkBundle(bundle, { root });
  assert.ok(problems.some((p) => p.includes("missing from versioning.json")));
  assert.ok(problems.some((p) => p.includes("has id Other")));
  assert.ok(problems.some((p) => p.includes("icon logo.png")));
  assert.ok(problems.some((p) => p.includes("paperback://addRepo")));
});
