#!/usr/bin/env node
// `paperback-cli test` (toolchain 1.0.0-alpha.92) exits 0 even when tests fail, and silently
// skips a source with no test file. This reads the --output report and fails on either.
//
//   node scripts/check-tests.mjs [--report bundles/tests.json] [Name...]

import fs from "node:fs";

export function summarize(report, expected = []) {
  const problems = [];
  for (const name of expected) {
    if (!(name in report))
      problems.push(
        `${name}: no result in the report (missing src/tests/${name}.ts, or the bundle failed)`,
      );
  }
  let passed = 0;
  for (const [name, result] of Object.entries(report)) {
    if (result.error) problems.push(`${name}: ${result.error}`);
    for (const t of result.tests ?? []) {
      if (t.status === "pass" && !t.error) passed++;
      else problems.push(`${name} > ${t.name}: ${t.status}${t.error ? ` (${t.error})` : ""}`);
    }
    if (!result.error && !(result.tests ?? []).length) problems.push(`${name}: ran no tests`);
  }
  return { passed, problems };
}

function main(argv) {
  let reportPath = "bundles/tests.json";
  const expected = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--report") reportPath = argv[++i];
    else expected.push(argv[i]);
  }
  if (!fs.existsSync(reportPath)) {
    console.log(`No test report at ${reportPath}: run \`npm test\` (it writes the report) first.`);
    return 1;
  }
  const { passed, problems } = summarize(JSON.parse(fs.readFileSync(reportPath, "utf8")), expected);
  for (const problem of problems) console.log(`FAIL ${problem}`);
  console.log(`${passed} test(s) passed, ${problems.length} problem(s).`);
  if (problems.length) {
    console.log(
      "A failure can be the live site or the sandbox's network rather than the source: read the error before blaming either.",
    );
  }
  return problems.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
