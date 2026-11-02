#!/usr/bin/env node
// Shows how merged inkdex sources do what a source here does, so a change follows the merged
// pattern instead of inventing one. Reads inkdex/general-extensions at upstream/0.9/stable
// through git, so no second checkout is needed.
//
//   node scripts/upstream-usage.mjs <Name> [--fetch] [--ref upstream/0.9/stable]
//   node scripts/upstream-usage.mjs --feature <regex>      where upstream uses a pattern

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const UPSTREAM_URL = "https://github.com/inkdex/general-extensions";

// Features worth comparing: SDK surface and the patterns reviews keep asking about.
const FEATURES = [
  ["Cloudflare bypass hook", /cloudflareBypassCompleted/],
  ["Cloudflare detection in interceptResponse", /new CloudflareError\(/],
  ["Cookie persistence", /CookieStorageInterceptor/],
  ["Rate limiter", /BasicRateLimiter/],
  ["Update pre-check", /processTitlesForUpdates/],
  ["Sorting options", /getSortingOptions/],
  ["Advanced search form", /extends AdvancedSearchForm/],
  ["Tri-state genre filter", /TriStateSelectRow/],
  ["Settings form", /getSettingsForm/],
  ["Featured carousel", /featuredCarouselItem/],
  ["Prominent carousel", /prominentCarouselItem/],
  ["Chapter updates carousel", /chapterUpdatesCarouselItem/],
  ["Genres carousel", /genresCarouselItem/],
  ["Pagination sentinel", /EndOfPageResults/],
  ["Novel chapters (html)", /type:\s*["']html["']/],
  ["Novel content type", /contentType:\s*["']novel["']/],
  ["WebView usage", /WebView|webView|evaluateScript|Application\.executeInWebView/],
  ["Image rewrite / descramble", /PBCanvas|PBImage|createPBCanvas|createPBImage/],
  ["Subtle crypto", /crypto\.subtle/],
  ["Memoized session promise", /Promise\s*\??\s*;|\?\?=\s*fetch/],
  ["Persisted state", /Application\.(getState|setState)/],
  ["Discover invalidation", /invalidateDiscoverSections/],
  ["HTML entity decoding", /decodeHTMLEntities/],
  ["Default user agent", /getDefaultUserAgent/],
  ["Cheerio parsing", /cheerio\.load|from ["']cheerio["']/],
  ["GraphQL", /graphql|query\s*\(/i],
  ["Locked/paid chapters", /isLocked|locked|price\s*>|coin/i],
  ["URL builder", /new URL\(/],
  ["Mirror/base-url setting", /mirror|BASE_URL_KEY|baseUrl/i],
];

const git = (...args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });

function ensureUpstream(ref, fetch) {
  const remotes = git("remote").split("\n");
  if (!remotes.includes("upstream")) git("remote", "add", "upstream", UPSTREAM_URL);
  try {
    if (fetch) throw new Error("fetch requested");
    git("rev-parse", "--verify", "--quiet", ref);
  } catch {
    git("fetch", "--quiet", "upstream", "0.9/stable");
  }
}

// Reads every upstream source file once, through one `git cat-file --batch`.
function upstreamFiles(ref) {
  const files = git("ls-tree", "-r", "--name-only", ref, "src")
    .split("\n")
    .filter((file) => file.endsWith(".ts") && !file.startsWith("src/tests/"));
  const output = execFileSync("git", ["cat-file", "--batch"], {
    cwd: ROOT,
    input: files.map((file) => `${ref}:${file}`).join("\n") + "\n",
    maxBuffer: 256 << 20,
  });
  const result = [];
  let offset = 0;
  for (const file of files) {
    const headerEnd = output.indexOf(10, offset);
    const size = Number(output.toString("utf8", offset, headerEnd).split(" ")[2]);
    const text = output.toString("utf8", headerEnd + 1, headerEnd + 1 + size);
    result.push({ file, text, lines: text.split("\n") });
    offset = headerEnd + 1 + size + 1;
  }
  return result;
}

const sourceName = (file) => file.split("/")[1];

function lastTouched(ref) {
  const dates = new Map();
  for (const line of git("log", "--format=%x00%cs", "--name-only", ref, "--", "src").split("\n")) {
    if (line.startsWith("\0")) dates.current = line.slice(1);
    else if (line.startsWith("src/") && !line.startsWith("src/tests/")) {
      const name = sourceName(line);
      if (!dates.has(name)) dates.set(name, dates.current);
    }
  }
  return dates;
}

function localFiles(name) {
  const dir = path.join(ROOT, "src", name);
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const exportedNames = (text) =>
  [
    ...text.matchAll(/export\s+(?:async\s+)?(?:const|function|class|type|interface|enum)\s+(\w+)/g),
  ].map((m) => m[1]);

function usage(upstream, regex) {
  const hits = new Map();
  for (const { file, lines } of upstream) {
    const index = lines.findIndex((line) => regex.test(line));
    if (index !== -1 && !hits.has(sourceName(file)))
      hits.set(sourceName(file), `${file}:${index + 1}`);
  }
  return hits;
}

function main(argv) {
  let ref = "upstream/0.9/stable";
  let fetch = false;
  let feature;
  let name;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ref") ref = argv[++i];
    else if (argv[i] === "--fetch") fetch = true;
    else if (argv[i] === "--feature") feature = new RegExp(argv[++i]);
    else name = argv[i];
  }
  if (!name && !feature) {
    console.error("usage: upstream-usage.mjs <Name> [--fetch] | --feature <regex>");
    return 2;
  }
  ensureUpstream(ref, fetch);
  const upstream = upstreamFiles(ref);
  const touched = lastTouched(ref);
  const byRecency = (a, b) => (touched.get(b) ?? "").localeCompare(touched.get(a) ?? "");
  const describe = (hits) =>
    [...hits.keys()]
      .sort(byRecency)
      .slice(0, 5)
      .map((source) => `${hits.get(source)} (${touched.get(source)})`);

  console.log(
    `Upstream: ${ref} (${git("log", "-1", "--format=%h %cs", ref).trim()}), newest-touched sources first.`,
  );
  if (feature) {
    for (const line of describe(usage(upstream, feature))) console.log(`  ${line}`);
    return 0;
  }

  const files = localFiles(name);
  const text = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const sameName = upstream.filter(({ file }) => sourceName(file) === name);
  if (sameName.length) {
    console.log(
      `\n${name} exists upstream. Compare before changing it: git diff ${ref} HEAD -- src/${name}`,
    );
  }

  console.log(`\nFeatures ${name} uses, and merged sources that implement the same thing:`);
  for (const [label, regex] of FEATURES) {
    if (!regex.test(text)) continue;
    const hits = usage(upstream, regex);
    hits.delete(name);
    console.log(
      `- ${label}: ${hits.size ? "" : "no merged source does this; justify it in the PR description"}`,
    );
    for (const line of describe(hits)) console.log(`    ${line}`);
  }

  // Names several merged sources share are the repository's vocabulary (fetchJSON, SECTIONS, SAFE_ID_REGEX…).
  const sharedBy = new Map();
  for (const { file, text: content } of upstream) {
    for (const exported of exportedNames(content)) {
      sharedBy.set(exported, (sharedBy.get(exported) ?? new Set()).add(sourceName(file)));
    }
  }
  const vocabulary = [...sharedBy]
    .filter(([, sources]) => sources.size >= 3)
    .sort((a, b) => b[1].size - a[1].size);
  const ours = new Set(exportedNames(text));
  const lower = new Map([...ours].map((exported) => [exported.toLowerCase(), exported]));
  const nearMisses = vocabulary.filter(
    ([common]) => !ours.has(common) && lower.has(common.toLowerCase()),
  );
  console.log("\nMerged vocabulary (names 3+ upstream sources export):");
  console.log(
    `  ${vocabulary.map(([common, sources]) => `${common}${ours.has(common) ? "*" : ""} (${sources.size})`).join(", ")}`,
  );
  console.log("  * = this source uses it too");
  for (const [common] of nearMisses)
    console.log(`  Rename ${lower.get(common.toLowerCase())} to the merged spelling ${common}.`);

  const layout = fs.readdirSync(path.join(ROOT, "src", name)).sort((a, b) => a.localeCompare(b));
  console.log(`\nLayout: ${layout.join(", ")}`);
  console.log(
    "Recent maintainer rewrites worth reading for shape: FlameComics, MangaFire, Mangago, AllManga, HiveToons (git log upstream/0.9/stable --author='Nicholas Lim').",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
