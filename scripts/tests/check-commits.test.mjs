import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EMAIL, NAME, checkCommit, readCommits } from "../check-commits.mjs";

const good = {
  sha: "0123456789abcdef",
  authorName: NAME,
  authorEmail: EMAIL,
  committerName: NAME,
  committerEmail: EMAIL,
  message: "fix(Mangago): keep chapter order\n\nOne sentence.\n",
  signed: false,
};

void test("a Popmango commit with an Assisted-by trailer passes", () => {
  assert.deepEqual(
    checkCommit(
      { ...good, message: `${good.message}\nAssisted-by: ClaudeCode:x\n` },
      { allowAssisted: true },
    ),
    [],
  );
});

void test("co-author lines, session links and generated-by lines fail", () => {
  for (const line of [
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "co-authored-by: someone <a@b.c>",
    "Claude-Session: https://claude.ai/code/session_x",
    "Generated with [Claude Code](https://claude.com/claude-code)",
  ])
    assert.ok(checkCommit({ ...good, message: `${good.message}\n${line}\n` }).length > 0, line);
});

void test("another author or committer, or a signature, fails", () => {
  assert.ok(checkCommit({ ...good, authorName: "Claude" })[0].includes("author"));
  assert.ok(checkCommit({ ...good, committerEmail: "x@y.z" })[0].includes("committer"));
  assert.ok(checkCommit({ ...good, signed: true })[0].includes("signed"));
});

void test("readCommits reads identity and message from a real repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-commits-"));
  const git = (args, env = {}) =>
    execFileSync("git", args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
  git(["init", "-q"]);
  fs.writeFileSync(path.join(root, "a"), "a\n");
  git(["add", "a"]);
  const id = {
    GIT_AUTHOR_NAME: NAME,
    GIT_AUTHOR_EMAIL: EMAIL,
    GIT_COMMITTER_NAME: NAME,
    GIT_COMMITTER_EMAIL: EMAIL,
  };
  git(["-c", "commit.gpgsign=false", "commit", "-q", "-m", "chore: one", "-m", "Body."], id);
  fs.writeFileSync(path.join(root, "a"), "b\n");
  git(
    [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qam",
      "chore: two",
      "-m",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ],
    id,
  );
  const commits = readCommits(root, ["HEAD"]);
  assert.equal(commits.length, 2);
  assert.deepEqual(checkCommit(commits[1]), []);
  assert.ok(checkCommit(commits[0]).some((p) => p.includes("attribution")));
});

void test("own branches reject Assisted-by and non-Claude attribution", () => {
  for (const line of [
    "Assisted-by: Tool:model",
    "Generated with Codex",
    "Agent-Session: example",
    "Signed-off-by: Example <x@y.invalid>",
    "https://example.com/session/123",
  ]) {
    assert.ok(checkCommit({ ...good, message: `${good.message}\n${line}` }).length > 0, line);
  }
});
