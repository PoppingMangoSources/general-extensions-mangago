import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { findDrift, writeCopies } from "../sync-agent-docs.mjs";

const POINTERS =
  ".claude/skills/paperback-extension/SKILL.md .agents/skills/paperback-extension/SKILL.md";

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-docs-"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), `rules ${POINTERS}\n`);
  fs.mkdirSync(path.join(root, ".claude/skills/paperback-extension/references"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(root, ".claude/skills/paperback-extension/SKILL.md"), "skill\n");
  fs.writeFileSync(path.join(root, ".claude/skills/paperback-extension/references/a.md"), "a\n");
  return root;
}

void test("writeCopies makes identical copies that pass the check", () => {
  const root = repo();
  assert.ok(findDrift(root).length > 0);
  writeCopies(root);
  assert.deepEqual(findDrift(root), []);
});

void test("an edit to one copy, an extra mirror file or a symlinked mirror fails", () => {
  const root = repo();
  writeCopies(root);
  fs.appendFileSync(path.join(root, "CLAUDE.md"), "drift\n");
  fs.writeFileSync(path.join(root, ".agents/skills/paperback-extension/stray.md"), "x\n");
  const problems = findDrift(root);
  assert.ok(problems.some((p) => p.includes("CLAUDE.md")));
  assert.ok(problems.some((p) => p.includes("stray.md")));
  fs.rmSync(path.join(root, ".agents/skills"), { recursive: true });
  fs.symlinkSync("../.claude/skills", path.join(root, ".agents/skills"));
  assert.ok(findDrift(root).some((p) => p.includes("symlink")));
});

void test("AGENTS.md must point at both skill copies", () => {
  const root = repo();
  fs.writeFileSync(path.join(root, "AGENTS.md"), "rules without pointers\n");
  writeCopies(root);
  assert.ok(findDrift(root).some((p) => p.includes("does not point")));
});
