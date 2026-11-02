#!/usr/bin/env node
// Fails a push whose own commits are not authored and committed by Popmango Extensions, are
// signed, or carry agent attribution (Co-Authored-By, session links, "Generated with" lines).
// Exact push and CI ranges include merged commits; stable alone retains its upstream-import
// first-parent policy. Assisted-by is permitted only on upstream submission branches.
//
//   node scripts/check-commits.mjs [<rev-list arguments>]   (default: HEAD --not --remotes)
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const NAME = "Popmango Extensions";
export const EMAIL = "297959108+PoppingMangoSources@users.noreply.github.com";

const ATTRIBUTION = [
  /^co-authored-by:/im,
  /^claude-session:/im,
  /generated (with|by) \[?claude/i,
  /noreply@anthropic\.com/i,
  /claude\.ai\/code\/session/i,
  /^\s*(?:[\w-]*session[\w-]*|signed-off-by)\s*:/im,
  /\bgenerated (?:with|by)\b/i,
  /https?:\/\//i,
  /#\d+\b/,
];

export const checkCommit = (
  { sha, authorName, authorEmail, committerName, committerEmail, message, signed },
  { allowAssisted = false } = {},
) => {
  const problems = [];
  const short = sha.slice(0, 8);
  if (authorName !== NAME || authorEmail !== EMAIL)
    problems.push(`${short}: author is ${authorName} <${authorEmail}>, not ${NAME}`);
  if (committerName !== NAME || committerEmail !== EMAIL)
    problems.push(`${short}: committer is ${committerName} <${committerEmail}>, not ${NAME}`);
  if (signed) problems.push(`${short}: signed; commits here are unsigned`);
  for (const pattern of ATTRIBUTION)
    if (pattern.test(message))
      problems.push(`${short}: message carries agent attribution (${pattern.source})`);
  if (!allowAssisted && /^\s*assisted-by\s*:/im.test(message))
    problems.push(`${short}: Assisted-by is only allowed on upstream submission branches`);
  return problems;
};

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

export const readCommits = (cwd, revArgs) => {
  const shas = git(cwd, ["rev-list", ...revArgs])
    .split("\n")
    .filter(Boolean);
  return shas.map((sha) => {
    const [authorName, authorEmail, committerName, committerEmail, ...rest] = git(cwd, [
      "show",
      "-s",
      "--format=%an%n%ae%n%cn%n%ce%n%B",
      sha,
    ]).split("\n");
    const signed = /^gpgsig(?:-sha256)? /m.test(
      git(cwd, ["cat-file", "commit", sha]).split("\n\n")[0],
    );
    return {
      sha,
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      message: rest.join("\n"),
      signed,
    };
  });
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cwd = process.cwd();
  const [mode, argument] = process.argv.slice(2);
  let branch =
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    git(cwd, ["branch", "--show-current"]).trim();
  const commits = [];
  const problems = [];
  const inspect = (before, after, ref) => {
    if (/^0+$/.test(after)) return;
    branch = ref;
    if (/^(?:claude|codex|copilot)\//i.test(ref))
      problems.push("Agent-named branches are forbidden");
    let revArgs;
    if (before && !/^0+$/.test(before)) {
      if (spawnSync("git", ["cat-file", "-e", `${before}^{commit}`], { cwd }).status !== 0) {
        if (!/^[0-9a-f]{40,64}$/.test(before)) throw new Error("Invalid previous commit SHA");
        execFileSync("git", ["fetch", "--no-tags", "origin", before], { cwd, stdio: "inherit" });
      }
      revArgs = [`${before}..${after}`];
    } else {
      const refs = git(cwd, ["for-each-ref", "--format=%(refname)", "refs/remotes/"])
        .trim()
        .split("\n")
        .filter((value) => value && value !== `refs/remotes/origin/${ref}`);
      revArgs = [after, "--not", ...refs];
    }
    // Stable imports upstream history through a merge; inspect our own first-parent line.
    const found = readCommits(cwd, ref === "0.9/stable" ? ["--first-parent", ...revArgs] : revArgs);
    for (const commit of found)
      problems.push(...checkCommit(commit, { allowAssisted: /^(?:feature|bugfix)\//.test(ref) }));
  };
  if (mode === "--message") {
    const identity = (kind) => {
      const value = git(cwd, ["var", `GIT_${kind}_IDENT`]);
      const match = /^(.*) <([^>]+)>/.exec(value);
      return match ? [match[1], match[2]] : ["", ""];
    };
    const [authorName, authorEmail] = identity("AUTHOR");
    const [committerName, committerEmail] = identity("COMMITTER");
    problems.push(
      ...checkCommit(
        {
          sha: "pending",
          authorName,
          authorEmail,
          committerName,
          committerEmail,
          message: fs.readFileSync(argument, "utf8"),
          signed: false,
        },
        { allowAssisted: /^(?:feature|bugfix)\//.test(branch) },
      ),
    );
  } else if (mode === "--event") {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (event.pull_request)
      inspect(
        event.pull_request.base.sha,
        event.pull_request.head.sha,
        event.pull_request.head.ref,
      );
    else if (event.before && event.after)
      inspect(event.before, event.after, event.ref.replace(/^refs\/heads\//, ""));
    else
      problems.push(
        ...readCommits(cwd, ["--max-count=1", "HEAD"]).flatMap((commit) => checkCommit(commit)),
      );
  } else if (mode === "--pre-push") {
    for (const line of fs.readFileSync(0, "utf8").trim().split("\n").filter(Boolean)) {
      const [, after, ref, before] = line.split(/\s+/);
      inspect(before, after, ref.replace(/^refs\/heads\//, ""));
    }
  } else {
    const revArgs =
      process.argv.length > 2 ? process.argv.slice(2) : ["HEAD", "--not", "--remotes"];
    commits.push(...readCommits(cwd, revArgs));
    problems.push(
      ...commits.flatMap((commit) =>
        checkCommit(commit, { allowAssisted: /^(?:feature|bugfix)\//.test(branch) }),
      ),
    );
  }
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(
      `\nCommits are authored and committed by ${NAME} <${EMAIL}>, unsigned, with no co-author or agent lines (AGENTS.md section 8).`,
    );
    process.exit(1);
  }
  console.log(`Commit identity OK (${commits.length} unpushed commit(s)).`);
}
