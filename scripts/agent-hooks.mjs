#!/usr/bin/env node
// Claude Code hooks (.claude/settings.json) that keep source work on the AGENTS.md workflow.
//
//   node scripts/agent-hooks.mjs pre-edit          PreToolUse: point at the skill before the first edit to a source
//   node scripts/agent-hooks.mjs stop              Stop: refuse to finish while a changed source fails its rules
//                                                  or has no passing review of its current files
//   node scripts/agent-hooks.mjs stamp <Name> <pass|fail>   record a review (scripts/review-source.sh does this)

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { changedSources } from "./check-sources.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE_BRANCH = process.env.PAPERBACK_BASE ?? "origin/0.9/test";

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

export function sourceOf(relative) {
  const parts = relative.split(path.sep);
  if (parts[0] !== "src" || parts.length < 3) return undefined;
  if (parts[1] === "tests") return parts[2].replace(/\.ts$/, "");
  return parts[1] === "utils" ? undefined : parts[1];
}

// Hash of the source's files and its test, so any edit after a review invalidates it.
export function treeHash(root, name) {
  const digest = crypto.createHash("sha256");
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  if (fs.existsSync(path.join(root, "src", name))) walk(path.join(root, "src", name));
  const testFile = path.join(root, "src/tests", `${name}.ts`);
  if (fs.existsSync(testFile)) files.push(testFile);
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    digest
      .update(path.relative(root, file))
      .update("\0")
      .update(fs.readFileSync(file))
      .update("\0");
  }
  return digest.digest("hex");
}

const stampPath = (name) =>
  path.join(
    git("rev-parse", "--absolute-git-dir") || path.join(ROOT, ".git"),
    "paperback-review",
    `${name}.json`,
  );

const readStamp = (name) => {
  try {
    return JSON.parse(fs.readFileSync(stampPath(name), "utf8"));
  } catch {
    return {};
  }
};

function preEdit(event) {
  const target = event.tool_input?.file_path;
  if (!target) return;
  const relative = path.relative(ROOT, path.resolve(target));
  if (relative.startsWith("..")) return;
  const name = sourceOf(relative);
  if (!name) return;
  const seenFile = path.join(
    os.tmpdir(),
    "paperback-hooks",
    `${event.session_id ?? "session"}.json`,
  );
  const seen = fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, "utf8")) : [];
  if (seen.includes(name)) return;
  fs.mkdirSync(path.dirname(seenFile), { recursive: true });
  fs.writeFileSync(seenFile, JSON.stringify([...seen, name]));
  const message =
    `You are editing the ${name} source. Follow the paperback-extension skill (.claude/skills/paperback-extension/SKILL.md; load it if it is not loaded): ` +
    `compare with how merged inkdex sources implement the same thing (\`node scripts/upstream-usage.mjs ${name}\`), keep to references/standards.md, ` +
    `and before calling the work done run \`scripts/review-source.sh ${name}\` and read references/review.md against the diff.`;
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: message },
    }),
  );
}

function stop(event) {
  const base = git("merge-base", "HEAD", BASE_BRANCH) || "HEAD";
  const names = changedSources(ROOT, base);
  if (!names.length) return;
  const problems = [];
  const check = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts/check-sources.mjs"), "--base", base, ...names],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (check.status) problems.push(`check-sources fails:\n${check.stdout.trim()}`);
  for (const name of names) {
    const stamp = readStamp(name);
    if (stamp.tree !== treeHash(ROOT, name))
      problems.push(`${name} changed since its last review: run scripts/review-source.sh ${name}.`);
    else if (stamp.status !== "pass") {
      problems.push(
        `scripts/review-source.sh ${name} last failed: fix it, or tell the user which failure is the live site or the sandbox network rather than the source.`,
      );
    }
  }
  if (!problems.length) return;
  if (event.stop_hook_active) {
    // Already asked once this turn; report rather than loop.
    console.error(problems.join("\n\n"));
    return;
  }
  console.log(JSON.stringify({ decision: "block", reason: problems.join("\n\n") }));
}

function stampReview(name, status) {
  const file = stampPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ tree: treeHash(ROOT, name), status, at: new Date().toISOString() }),
  );
}

function main(argv) {
  const [command, ...rest] = argv;
  if (command === "pre-edit" || command === "stop") {
    // Informational edit reminders can fail open; failed Stop validation must be visible.
    try {
      const input = fs.readFileSync(0, "utf8");
      (command === "pre-edit" ? preEdit : stop)(input ? JSON.parse(input) : {});
    } catch (error) {
      console.error(`agent-hooks ${command}: ${String(error)}`);
      if (command === "stop")
        console.log(
          JSON.stringify({
            decision: "block",
            reason: `Workflow validation could not run: ${String(error)}`,
          }),
        );
    }
    return 0;
  }
  if (command === "stamp" && rest.length === 2) {
    stampReview(rest[0], rest[1]);
    return 0;
  }
  console.error("usage: agent-hooks.mjs pre-edit | stop | stamp <Name> <pass|fail>");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
