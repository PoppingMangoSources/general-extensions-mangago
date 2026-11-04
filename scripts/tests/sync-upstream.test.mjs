import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EMAIL, NAME } from "../check-commits.mjs";

void test("upstream merges retain enforcement workflows, hooks and npm commands", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-sync-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, "upstream"),
    remote = path.join(root, "remote.git"),
    work = path.join(root, "work");
  const run = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  const write = (cwd, file, text) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), text);
  };
  const identity = (cwd) => {
    run(cwd, "config", "user.name", NAME);
    run(cwd, "config", "user.email", EMAIL);
    run(cwd, "config", "commit.gpgsign", "false");
  };
  fs.mkdirSync(upstream);
  run(upstream, "init", "-q", "-b", "0.9/stable");
  identity(upstream);
  write(
    upstream,
    "package.json",
    JSON.stringify({ scripts: { prepare: "husky", bundle: "original bundle" } }),
  );
  write(upstream, "package-lock.json", "{}");
  write(upstream, ".github/workflows/check.yaml", "upstream base\n");
  write(upstream, ".github/workflows/unchanged.yaml", "retained validation\n");
  run(upstream, "add", ".");
  run(upstream, "commit", "-qm", "chore: baseline");
  run(root, "clone", "--bare", upstream, remote);
  run(root, "clone", remote, work);
  identity(work);
  run(work, "remote", "add", "upstream", upstream);
  write(work, ".github/workflows/check.yaml", "owner validation\n");
  write(
    work,
    ".claude/settings.json",
    JSON.stringify({ attribution: { commit: "", pr: "", sessionUrl: false } }),
  );
  write(work, ".husky/pre-push", "owner validation hook\n");
  write(
    work,
    "package.json",
    JSON.stringify({
      scripts: {
        prepare: "node scripts/setup-git.mjs",
        bundle: "owner bundle",
        validate: "node scripts/validate.mjs",
      },
    }),
  );
  write(
    work,
    "scripts/sync-upstream.sh",
    fs.readFileSync(new URL("../sync-upstream.sh", import.meta.url), "utf8"),
  );
  run(work, "add", ".");
  run(work, "commit", "-qm", "chore: owner tooling");
  run(work, "push", "origin", "0.9/stable");
  write(upstream, ".github/workflows/check.yaml", "upstream replacement\n");
  write(upstream, ".github/workflows/unchanged.yaml", "upstream replacement\n");
  write(
    upstream,
    "package.json",
    JSON.stringify({
      scripts: { prepare: "husky", bundle: "new upstream bundle", added: "new upstream command" },
    }),
  );
  run(upstream, "add", ".");
  run(upstream, "commit", "-qm", "chore: upstream update");
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  for (const name of ["npm", "npx"]) {
    write(bin, name, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  execFileSync("bash", ["scripts/sync-upstream.sh"], {
    cwd: work,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    stdio: "pipe",
  });
  assert.equal(
    fs.readFileSync(path.join(work, ".github/workflows/check.yaml"), "utf8"),
    "owner validation\n",
  );
  assert.equal(
    fs.readFileSync(path.join(work, ".github/workflows/unchanged.yaml"), "utf8"),
    "retained validation\n",
  );
  assert.equal(
    fs.readFileSync(path.join(work, ".husky/pre-push"), "utf8"),
    "owner validation hook\n",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(work, ".claude/settings.json"))).attribution.sessionUrl,
    false,
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(work, "package.json")));
  assert.equal(pkg.scripts.prepare, "node scripts/setup-git.mjs");
  assert.equal(pkg.scripts.bundle, "owner bundle");
  assert.equal(pkg.scripts.validate, "node scripts/validate.mjs");
  assert.equal(pkg.scripts.added, "new upstream command");
  const message = run(work, "show", "-s", "--format=%an%n%ae%n%cn%n%ce%n%B");
  assert.ok(message.startsWith(`${NAME}\n${EMAIL}\n${NAME}\n${EMAIL}`));
  assert.doesNotMatch(message, /co-authored-by|session:/i);
  assert.equal(run(work, "show", "-s", "--format=%P").split(" ").length, 2);
});
