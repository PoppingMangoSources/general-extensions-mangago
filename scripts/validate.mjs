import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
process.chdir(root);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit", ...options });
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
try {
  const [mode, argument] = process.argv.slice(2);
  let base;
  let branch =
    process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git("branch", "--show-current");
  if (mode === "--event") {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    run(process.execPath, ["scripts/check-commits.mjs", "--event"]);
    base = event.pull_request?.base.sha ?? event.before;
    branch = event.pull_request?.head.ref ?? event.ref?.replace(/^refs\/heads\//, "") ?? branch;
  } else if (mode === "--pre-push") {
    const input = fs.readFileSync(0, "utf8");
    run(process.execPath, ["scripts/check-commits.mjs", "--pre-push"], {
      input,
      stdio: ["pipe", "inherit", "inherit"],
    });
    const updates = input
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(/\s+/));
    const outgoing = updates.filter(([, sha]) => !/^0+$/.test(sha));
    if (!outgoing.length) process.exit(0);
    if (outgoing.some(([, sha]) => sha !== git("rev-parse", "HEAD")))
      throw new Error("Check out and validate each branch before pushing it");
    base = outgoing.find(([, , , before]) => !/^0+$/.test(before))?.[3];
    if (git("status", "--porcelain", "--", ".", ":(exclude)bundles").length)
      throw new Error("Commit the changes before validating the exact push snapshot");
  } else if (mode === "--base" && argument) {
    base = argument;
    run(process.execPath, ["scripts/check-commits.mjs"]);
  } else if (!mode) {
    run(process.execPath, ["scripts/check-commits.mjs"]);
  } else throw new Error("Usage: validate.mjs [--base REF | --event | --pre-push]");
  if (!base || /^0+$/.test(base)) base = "origin/0.9/test";
  git("rev-parse", "--verify", `${base}^{commit}`);
  for (const command of ["conformance", "check:docs", "test:scripts"]) run("npm", ["run", command]);
  // Stable mirrors upstream code; its source rules and unit tests belong to upstream.
  if (branch !== "0.9/stable") {
    run("npm", ["run", "test:unit"]);
    run(process.execPath, ["scripts/check-sources.mjs", "--base", base]);
  }
  run("npm", ["run", "bundle"]);
  run("npm", ["run", "check:bundle"]);
  console.log("All offline repository gates passed. Live and device checks remain separate.");
} catch (error) {
  console.error(`Validation failed: ${String(error)}`);
  process.exitCode = 1;
}
