#!/usr/bin/env node
// Keeps the instruction copies identical so every agent reads the full rules directly:
// AGENTS.md -> CLAUDE.md (root and docs/), and .claude/skills -> .agents/skills (a physical copy,
// not a symlink, so each client reads real files). Edit AGENTS.md and .claude/skills.
//
//   node scripts/sync-agent-docs.mjs           write the copies
//   node scripts/sync-agent-docs.mjs --check   fail on drift, write nothing

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAIRS = [
  ["AGENTS.md", "CLAUDE.md"],
  ["docs/AGENTS.md", "docs/CLAUDE.md"],
];
const SKILLS = [".claude/skills", ".agents/skills"];
const SKILL_POINTERS = [
  ".claude/skills/paperback-extension/SKILL.md",
  ".agents/skills/paperback-extension/SKILL.md",
];

const listFiles = (dir) => {
  if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) return new Map();
  const files = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(dir, full), fs.readFileSync(full));
    }
  };
  walk(dir);
  return files;
};

export function findDrift(root = ROOT) {
  const problems = [];
  for (const [source, copy] of PAIRS) {
    const a = path.join(root, source);
    const b = path.join(root, copy);
    if (!fs.existsSync(a)) continue;
    if (!fs.existsSync(b) || !fs.readFileSync(a).equals(fs.readFileSync(b)))
      problems.push(`${copy} differs from ${source}`);
  }
  const mirror = path.join(root, SKILLS[1]);
  if (fs.existsSync(mirror) && fs.lstatSync(mirror).isSymbolicLink())
    problems.push(`${SKILLS[1]} must be a physical copy, not a symlink`);
  const primary = listFiles(path.join(root, SKILLS[0]));
  const copy = listFiles(mirror);
  for (const [file, bytes] of primary) {
    if (!copy.has(file)) problems.push(`${SKILLS[1]}/${file} is missing`);
    else if (!copy.get(file).equals(bytes)) problems.push(`${SKILLS[1]}/${file} differs`);
  }
  for (const file of copy.keys())
    if (!primary.has(file)) problems.push(`${SKILLS[1]}/${file} has no source in ${SKILLS[0]}`);
  const agents = path.join(root, "AGENTS.md");
  if (fs.existsSync(agents)) {
    const text = fs.readFileSync(agents, "utf8");
    for (const pointer of SKILL_POINTERS)
      if (!text.includes(pointer)) problems.push(`AGENTS.md does not point to ${pointer}`);
  }
  return problems;
}

export function writeCopies(root = ROOT) {
  for (const [source, copy] of PAIRS) {
    if (fs.existsSync(path.join(root, source)))
      fs.copyFileSync(path.join(root, source), path.join(root, copy));
  }
  const mirror = path.join(root, SKILLS[1]);
  fs.rmSync(mirror, { recursive: true, force: true });
  fs.cpSync(path.join(root, SKILLS[0]), mirror, { recursive: true });
}

function main(argv) {
  if (argv.includes("--check")) {
    const problems = findDrift();
    for (const problem of problems) console.log(`FAIL ${problem}`);
    console.log(
      problems.length
        ? "Run node scripts/sync-agent-docs.mjs after editing AGENTS.md or .claude/skills."
        : "Instruction copies match.",
    );
    return problems.length ? 1 : 0;
  }
  writeCopies();
  console.log("Synchronized CLAUDE.md copies and .agents/skills.");
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
