#!/usr/bin/env node
// Checks what `paperback-cli bundle` published: one directory per source with index.js and an
// info.json whose id is the directory name (the installed id), the icon it names, a versioning.json
// listing every source and built with the installed toolchain and types, and a homepage that
// still carries the paperback:// links readers install from.
//
//   node scripts/check-bundle.mjs [bundles/<folder>]

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

export function checkBundle(bundleDir, { root = ROOT } = {}) {
  const problems = [];
  const versioningPath = path.join(bundleDir, "versioning.json");
  if (!fs.existsSync(versioningPath)) return [`${versioningPath} is missing: run npm run bundle`];
  const versioning = JSON.parse(fs.readFileSync(versioningPath, "utf8"));
  const installed = (name) => {
    const file = path.join(root, "node_modules", name, "package.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).version : undefined;
  };
  for (const [key, name] of [
    ["toolchain", "@paperback/toolchain"],
    ["types", "@paperback/types"],
  ]) {
    const version = installed(name);
    if (version && versioning.builtWith?.[key] !== version)
      problems.push(`built with ${key} ${versioning.builtWith?.[key]}, installed ${version}`);
  }

  const srcDir = path.join(root, "src");
  const expected = fs.existsSync(srcDir)
    ? fs
        .readdirSync(srcDir)
        .filter((dir) =>
          ["pbconfig.ts", "main.ts"].every((file) => fs.existsSync(path.join(srcDir, dir, file))),
        )
    : [];
  const listed = new Set((versioning.sources ?? []).map((source) => source.id));
  for (const id of expected) {
    if (!listed.has(id)) problems.push(`${id} is missing from versioning.json`);
    const dir = path.join(bundleDir, id);
    if (!fs.existsSync(path.join(dir, "index.js"))) problems.push(`${id}/index.js is missing`);
    const infoPath = path.join(dir, "info.json");
    if (!fs.existsSync(infoPath)) {
      problems.push(`${id}/info.json is missing`);
      continue;
    }
    const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    if (info.id !== id) problems.push(`${id}/info.json has id ${info.id}`);
    if (!info.icon || !fs.existsSync(path.join(dir, "static", info.icon)))
      problems.push(`${id}: icon ${info.icon} is not in static/`);
    if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(info.version ?? ""))
      problems.push(`${id}: version ${info.version}`);
  }

  const homepage = path.join(bundleDir, "index.html");
  if (!fs.existsSync(homepage)) problems.push("index.html is missing");
  else {
    const html = fs.readFileSync(homepage, "utf8");
    for (const link of [
      "paperback://addRepo",
      "paperback://installExtensions",
      "versioning.json",
    ]) {
      if (!html.includes(link)) problems.push(`index.html no longer contains ${link}`);
    }
  }
  return problems;
}

function main(argv) {
  const bundleDir = path.resolve(argv[0] ?? path.join(ROOT, "bundles"));
  const problems = checkBundle(bundleDir);
  for (const problem of problems) console.log(`FAIL ${problem}`);
  console.log(
    problems.length
      ? `${problems.length} bundle problem(s).`
      : `Bundle at ${path.relative(ROOT, bundleDir) || "."} is complete.`,
  );
  return problems.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
