import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkSubmission, expectedVersion } from "../check-submission.mjs";

function repo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "submission-"));
  const git = (...args) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd, stdio: "ignore" },
    );
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
  };
  const commit = (message) => {
    git("add", "-A");
    git("commit", "-qm", message);
  };
  git("init", "-q", "-b", "upstream");
  write("README.md", "- [Alpha](https://a.example)\n- [Zulu](https://z.example)\n");
  write("src/Zulu/pbconfig.ts", 'export default { version: "1.0.0-alpha.4" };\n');
  write("package.json", "{}\n");
  commit("chore: base");
  git("checkout", "-q", "-b", "work");
  return { cwd, git, write, commit };
}

void test("expectedVersion starts new sources at alpha.1 and bumps existing ones", () => {
  assert.equal(expectedVersion(undefined), "1.0.0-alpha.1");
  assert.equal(expectedVersion("1.0.0-alpha.4"), "1.0.0-alpha.5");
});

void test("a new source with its test and README line is clean", () => {
  const { cwd, write, commit } = repo();
  write("src/Demo/pbconfig.ts", 'export default { version: "1.0.0-alpha.1" };\n');
  write("src/tests/Demo.ts", "test\n");
  write(
    "README.md",
    "- [Alpha](https://a.example)\n- [Demo](https://d.example)\n- [Zulu](https://z.example)\n",
  );
  commit("feat: Add Demo");
  assert.deepEqual(checkSubmission({ cwd, name: "Demo", base: "upstream" }), []);
});

void test("a commit outside the source fails even when a later commit reverts it", () => {
  const { cwd, write, commit } = repo();
  write("src/Demo/pbconfig.ts", 'export default { version: "1.0.0-alpha.1" };\n');
  write(
    "README.md",
    "- [Alpha](https://a.example)\n- [Demo](https://d.example)\n- [Zulu](https://z.example)\n",
  );
  write("package.json", '{"x":1}\n');
  commit("feat: Add Demo");
  write("package.json", "{}\n");
  commit("chore: revert package");
  const problems = checkSubmission({ cwd, name: "Demo", base: "upstream" });
  assert.ok(problems.some((p) => p.includes("package.json")));
});

void test("an update must bump upstream's version by one", () => {
  const { cwd, write, commit } = repo();
  write("src/Zulu/pbconfig.ts", 'export default { version: "1.0.0-alpha.9" };\n');
  commit("fix(Zulu): repair search");
  assert.ok(
    checkSubmission({ cwd, name: "Zulu", base: "upstream" }).some((p) => p.includes("alpha.5")),
  );
});

void test("a non-conventional subject and an edit to another README line fail", () => {
  const { cwd, write, commit } = repo();
  write("src/Zulu/pbconfig.ts", 'export default { version: "1.0.0-alpha.5" };\n');
  write("README.md", "- [Alpha](https://alpha.example)\n- [Zulu](https://z.example)\n");
  commit("Update stuff");
  const problems = checkSubmission({ cwd, name: "Zulu", base: "upstream" });
  assert.ok(problems.some((p) => p.includes("Conventional")));
  assert.ok(problems.some((p) => p.includes("README")));
});
