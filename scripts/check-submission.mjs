#!/usr/bin/env node
// Checks that a branch meant for an inkdex/general-extensions pull request carries one source
// and nothing else: every commit, not just the final diff, may touch only src/<Name>/,
// src/tests/<Name>.ts and that source's README line, and the version must follow upstream's.
//
//   node scripts/check-submission.mjs --source <Name> [--head HEAD] [--base upstream/0.9/stable] [--cwd <dir>]

import { execFileSync } from "node:child_process";

const run = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryRun = (cwd, ...args) => {
  try {
    return run(cwd, ...args);
  } catch {
    return undefined;
  }
};
const version = (text) => text?.match(/\bversion:\s*["'`]([^"'`]+)["'`]/)?.[1];

export function allowedPath(name, file) {
  return file === "README.md" || file === `src/tests/${name}.ts` || file.startsWith(`src/${name}/`);
}

export function expectedVersion(upstreamVersion) {
  if (!upstreamVersion) return "1.0.0-alpha.1";
  const match = upstreamVersion.match(/^(.*-alpha\.)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : undefined;
}

export function checkSubmission({ cwd, name, head = "HEAD", base = "upstream/0.9/stable" }) {
  const problems = [];
  const mergeBase = tryRun(cwd, "merge-base", base, head);
  if (!mergeBase) return [`${head} shares no history with ${base}: build the branch from ${base}`];
  if (mergeBase !== run(cwd, "rev-parse", base))
    problems.push(`${head} is not based on the current ${base}: rebase it`);

  const commits = run(cwd, "rev-list", "--reverse", `${mergeBase}..${head}`)
    .split("\n")
    .filter(Boolean);
  if (!commits.length) problems.push(`${head} has no commits on top of ${base}`);
  for (const commit of commits) {
    const short = commit.slice(0, 7);
    const parents = run(cwd, "rev-list", "--parents", "-n", "1", commit).split(" ").length - 1;
    if (parents > 1) problems.push(`${short} is a merge commit: submissions are linear`);
    const subject = run(cwd, "log", "-1", "--format=%s", commit);
    if (
      !/^(feat|fix|chore|refactor|perf|docs|style|test|build|ci|revert)(\([\w.-]+\))?!?: .+/.test(
        subject,
      )
    ) {
      problems.push(`${short} "${subject}" is not a Conventional Commit (type(Scope): summary)`);
    }
    for (const file of run(
      cwd,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "--root",
      commit,
    )
      .split("\n")
      .filter(Boolean)) {
      if (!allowedPath(name, file)) problems.push(`${short} touches ${file}, outside ${name}`);
    }
  }

  const changed = run(cwd, "diff", "--name-only", mergeBase, head).split("\n").filter(Boolean);
  for (const file of changed)
    if (!allowedPath(name, file)) problems.push(`the branch changes ${file}, outside ${name}`);

  if (changed.includes("README.md")) {
    const diff = run(cwd, "diff", "-U0", mergeBase, head, "--", "README.md")
      .split("\n")
      // README entries start with "-", so only the file headers are skipped, not "--" lines.
      .filter((line) => /^[-+]/.test(line) && !/^(---|\+\+\+) (a\/|b\/|\/dev\/null)/.test(line));
    for (const line of diff) {
      if (!line.startsWith("+") || !line.includes(`[${name}]`))
        problems.push(`README change is not just the ${name} entry: ${line}`);
    }
  }

  const upstreamVersion = version(tryRun(cwd, "show", `${base}:src/${name}/pbconfig.ts`));
  const headVersion = version(tryRun(cwd, "show", `${head}:src/${name}/pbconfig.ts`));
  const wanted = expectedVersion(upstreamVersion);
  if (headVersion !== wanted) {
    problems.push(
      `version is ${headVersion}; upstream has ${upstreamVersion ?? "no such source"}, so the submission should be ${wanted}`,
    );
  }
  if (!upstreamVersion && !changed.includes("README.md"))
    problems.push(`a new source must add its README entry`);
  return problems;
}

function main(argv) {
  const options = { cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") options.name = argv[++i];
    else if (argv[i] === "--head") options.head = argv[++i];
    else if (argv[i] === "--base") options.base = argv[++i];
    else if (argv[i] === "--cwd") options.cwd = argv[++i];
  }
  if (!options.name) {
    console.error(
      "usage: check-submission.mjs --source <Name> [--head <ref>] [--base <ref>] [--cwd <dir>]",
    );
    return 2;
  }
  const problems = checkSubmission(options);
  for (const problem of problems) console.log(`FAIL ${problem}`);
  console.log(
    problems.length
      ? `${problems.length} scope problem(s).`
      : `${options.name}: submission scope is clean.`,
  );
  return problems.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
