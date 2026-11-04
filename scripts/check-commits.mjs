#!/usr/bin/env node
// Fails a push whose own commits are not authored and committed by Popmango Extensions, are
// signed, or carry agent attribution (Co-Authored-By, session links, "Generated with" lines).
// Only first-parent commits not yet on any remote are checked, so merged upstream history and
// Dependabot commits already on GitHub are left alone. Assisted-by stays allowed: inkdex asks
// for it on submission commits.
//
//   node scripts/check-commits.mjs [<rev-list arguments>]   (default: HEAD --not --remotes)
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const NAME = "Popmango Extensions";
export const EMAIL = "297959108+PoppingMangoSources@users.noreply.github.com";

const ATTRIBUTION = [
  /^co-authored-by:/im,
  /^claude-session:/im,
  /generated (with|by) \[?claude/i,
  /noreply@anthropic\.com/i,
  /claude\.ai\/code\/session/i,
];

export const checkCommit = ({
  sha,
  authorName,
  authorEmail,
  committerName,
  committerEmail,
  message,
  signed,
}) => {
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
  return problems;
};

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

export const readCommits = (cwd, revArgs) => {
  const shas = git(cwd, ["rev-list", "--first-parent", ...revArgs])
    .split("\n")
    .filter(Boolean);
  return shas.map((sha) => {
    const [authorName, authorEmail, committerName, committerEmail, ...rest] = git(cwd, [
      "show",
      "-s",
      "--format=%an%n%ae%n%cn%n%ce%n%B",
      sha,
    ]).split("\n");
    const signed = /^gpgsig /m.test(git(cwd, ["cat-file", "commit", sha]).split("\n\n")[0]);
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
  const revArgs = process.argv.length > 2 ? process.argv.slice(2) : ["HEAD", "--not", "--remotes"];
  const commits = readCommits(process.cwd(), revArgs);
  const problems = commits.flatMap(checkCommit);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(
      `\nCommits are authored and committed by ${NAME} <${EMAIL}>, unsigned, with no co-author or agent lines (AGENTS.md section 8).`,
    );
    process.exit(1);
  }
  console.log(`Commit identity OK (${commits.length} unpushed commit(s)).`);
}
