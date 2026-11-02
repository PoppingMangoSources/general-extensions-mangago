import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EMAIL, NAME } from "../check-commits.mjs";

const root = path.resolve(import.meta.dirname, "../..");
void test("project attribution settings, session setup and publication gates stay enabled", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
  assert.deepEqual(settings.attribution, { commit: "", pr: "", sessionUrl: false });
  for (const event of ["SessionStart", "PreToolUse", "Stop"])
    assert.ok(settings.hooks[event]?.length, event);
  for (const file of ["source-checks.yaml", "bundle-deploy.yaml"]) {
    const text = fs.readFileSync(path.join(root, ".github/workflows", file), "utf8");
    assert.match(text, /fetch-depth: 0/);
    assert.match(text, /run: npm run validate -- --event/);
  }
  const hook = fs.readFileSync(path.join(root, ".husky/pre-push"), "utf8");
  assert.match(hook, /set -e/);
  assert.match(hook, /exec node scripts\/validate.mjs --pre-push/);
  assert.doesNotMatch(hook, /\$CI|echo HEAD|\|\| true/);
});

void test("Stop-hook parse failures block completion", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts/agent-hooks.mjs"), "stop"], {
    input: "{invalid",
    encoding: "utf8",
  });
  assert.equal(JSON.parse(result.stdout).decision, "block");
});

void test("CI validates already-pushed commits on every merge parent", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pb-enforcement-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", NAME);
  git("config", "user.email", EMAIL);
  git("config", "commit.gpgsign", "false");
  git("commit", "--allow-empty", "-qm", "chore: baseline");
  const base = git("rev-parse", "HEAD");
  git("checkout", "-qb", "side");
  git(
    "commit",
    "--allow-empty",
    "-qm",
    "chore: side",
    "-m",
    "Co-Authored-By: Example <example@example.invalid>",
  );
  git("checkout", "main");
  git("commit", "--allow-empty", "-qm", "chore: main");
  git("merge", "--no-ff", "side", "-m", "chore: merge");
  const after = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/0.9/test", after);
  const event = path.join(cwd, "event.json");
  fs.writeFileSync(event, JSON.stringify({ before: base, after, ref: "refs/heads/0.9/test" }));
  const result = spawnSync(
    process.execPath,
    [path.join(root, "scripts/check-commits.mjs"), "--event"],
    { cwd, env: { ...process.env, GITHUB_EVENT_PATH: event }, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /attribution/);
});

void test("automatic setup enables unsigned owner commits and rejects a co-author at commit time", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pb-commit-hook-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, "scripts"));
  fs.mkdirSync(path.join(cwd, ".husky"));
  for (const file of ["scripts/setup-git.mjs", "scripts/check-commits.mjs", ".husky/commit-msg"])
    fs.copyFileSync(path.join(root, file), path.join(cwd, file));
  fs.chmodSync(path.join(cwd, ".husky/commit-msg"), 0o755);
  execFileSync("git", ["init", "-q"], { cwd });
  execFileSync(process.execPath, [path.join(cwd, "scripts/setup-git.mjs")], { cwd });
  const config = (key) =>
    execFileSync("git", ["config", "--local", key], { cwd, encoding: "utf8" }).trim();
  assert.equal(config("user.email"), EMAIL);
  assert.equal(config("commit.gpgsign"), "false");
  const rejected = spawnSync(
    "git",
    [
      "commit",
      "--allow-empty",
      "-m",
      "chore: example",
      "-m",
      "Co-Authored-By: Example <a@example.invalid>",
    ],
    { cwd, encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  const accepted = spawnSync(
    "git",
    ["commit", "--allow-empty", "-m", "chore: example", "-m", "Keep the owner identity."],
    { cwd, encoding: "utf8" },
  );
  assert.equal(accepted.status, 0, accepted.stderr);
});
