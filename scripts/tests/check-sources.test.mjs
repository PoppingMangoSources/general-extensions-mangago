import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { changedSources, checkSource, splitSource } from "../check-sources.mjs";

const HEADER = "/* SPDX-License-Identifier: GPL-3.0-or-later */\n/* Copyright © 2026 Inkdex */\n";
const PNG = Buffer.concat([
  Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"),
  Buffer.from([0, 0, 0, 64, 0, 0, 0, 64]),
  Buffer.alloc(8),
]);
const TEST_FILE = `${HEADER}
import { type TestLogger } from "@paperback/types";

import { Demo } from "../Demo/main.js";
import sourceInfo from "../Demo/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Demo tests", logger);
  registerDefaultTests(suite, Demo, sourceInfo);

  await suite.run();
}
`;

function makeRepo(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-sources-"));
  const defaults = {
    "README.md": "- [Demo](https://demo.example)\n",
    "src/Demo/main.ts": `${HEADER}export const Demo = new DemoExtension();\n`,
    "src/Demo/pbconfig.ts": `${HEADER}export default { version: "1.0.0-alpha.1", language: "en", icon: "icon.png" };\n`,
    "src/tests/Demo.ts": TEST_FILE,
  };
  for (const [name, content] of Object.entries({ ...defaults, ...files })) {
    if (content === null) continue;
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
  fs.mkdirSync(path.join(root, "src/Demo/static"), { recursive: true });
  if (!("src/Demo/static/icon.png" in files))
    fs.writeFileSync(path.join(root, "src/Demo/static/icon.png"), PNG);
  return root;
}

const rules = (root) => checkSource(root, "Demo").map((finding) => finding.rule);
const withFile = (body) => makeRepo({ "src/Demo/parsers.ts": `${HEADER}${body}` });

void test("a minimal generated source passes", () => {
  assert.deepEqual(checkSource(makeRepo(), "Demo"), []);
});

void test("splitSource keeps code out of strings, comments and template text", () => {
  const { code, strings, comments } = splitSource(
    'const a = "console.log(1)"; // fetch(x)\nconst b = `x ${fetch(y)} z`;',
  );
  assert.ok(!code.includes("console.log"));
  assert.ok(strings.includes("console.log(1)"));
  assert.ok(comments.includes("fetch(x)"));
  assert.ok(code.includes("fetch(y)"), "template expressions stay code");
  assert.ok(!code.includes(" z`"));
});

void test("splitSource does not treat a quote inside a regex literal as a string", () => {
  const { code } = splitSource('const r = /["]/g; console.log(r);');
  assert.ok(code.includes("console.log"));
});

void test("console logging fails, but not inside a WebView script string", () => {
  assert.ok(rules(withFile("export const run = () => console.log(1);\n")).includes("console"));
  assert.ok(!rules(withFile('export const script = "console.log(1)";\n')).includes("console"));
});

void test("any fails, a typed Cheerio selection passes", () => {
  assert.ok(rules(withFile("export const f = (x: cheerio.Cheerio<any>) => x;\n")).includes("any"));
  assert.ok(
    !rules(withFile("export const f = (x: cheerio.Cheerio<AnyNode>) => x;\n")).includes("any"),
  );
});

void test("deprecated APIs fail", () => {
  assert.ok(rules(withFile("async saveCloudflareBypassCookies() {}\n")).includes("deprecated"));
  assert.ok(
    rules(withFile("const c = [SourceIntents.SEARCH_RESULTS_PROVIDING];\n")).includes("deprecated"),
  );
  assert.ok(
    !rules(withFile("const c = [SourceIntents.SEARCH_RESULT_PROVIDING];\n")).includes("deprecated"),
  );
});

void test("SelectRow options is a note, items is clean", () => {
  const findings = checkSource(
    withFile('SelectRow("a", { title: "A", options: [], value: [] });\n'),
    "Demo",
  );
  assert.equal(findings.find((f) => f.rule === "select-row-options")?.level, "N");
  assert.ok(
    !rules(
      withFile('SelectRow("a", { title: "A", items: [], layout: "list", value: [] });\n'),
    ).includes("select-row-options"),
  );
});

void test("divider comments fail, ordinary comments pass", () => {
  assert.ok(rules(withFile("// ---- Section ----\nexport const a = 1;\n")).includes("divider"));
  assert.ok(
    !rules(withFile("// The API pages from zero.\nexport const a = 1;\n")).includes("divider"),
  );
});

void test("a catch that only stringifies and rethrows fails", () => {
  assert.ok(
    rules(withFile("try { a(); } catch (e) { throw new Error(String(e)); }\n")).includes(
      "rethrow-string",
    ),
  );
  assert.ok(
    !rules(
      withFile("try { a(); } catch (e) { throw new Error(`Failed ${url}`, { cause: e }); }\n"),
    ).includes("rethrow-string"),
  );
});

void test("an empty catch fails unless a comment says why", () => {
  assert.ok(rules(withFile("try { a(); } catch {}\n")).includes("empty-catch"));
  assert.ok(
    !rules(withFile("try { a(); } catch {\n  // JSON-LD is optional on this page\n}\n")).includes(
      "empty-catch",
    ),
  );
});

void test("new Array and new SubtleCrypto fail, crypto.subtle passes", () => {
  assert.ok(rules(withFile("const c = new SubtleCrypto();\n")).includes("device-global"));
  assert.ok(rules(withFile("const a = new Array(3);\n")).includes("device-global"));
  assert.ok(
    !rules(withFile("const d = await crypto.subtle.digest('SHA-256', b);\n")).includes(
      "device-global",
    ),
  );
  assert.ok(!rules(withFile('const s = "new Array(3)";\n')).includes("device-global"));
});

void test("a raw fetch fails, a fetch helper passes", () => {
  assert.ok(rules(withFile("const r = await fetch(url);\n")).includes("raw-fetch"));
  assert.ok(!rules(withFile("const r = await fetchJSON(url);\n")).includes("raw-fetch"));
});

void test("SAFE_ID_REGEX must be canonical", () => {
  assert.ok(rules(withFile("const SAFE_ID_REGEX = /[^a-z0-9]/g;\n")).includes("safe-id-regex"));
  assert.ok(
    !rules(withFile("const SAFE_ID_REGEX = /[^a-zA-Z0-9._\\-@()[\\]%?#+=/&:]/g;\n")).includes(
      "safe-id-regex",
    ),
  );
});

void test("emoji in strings is a note; a star rating is not flagged", () => {
  assert.ok(rules(withFile('export const t = "🔒 Locked";\n')).includes("emoji"));
  assert.ok(!rules(withFile('export const t = "★ 8.9";\n')).includes("emoji"));
});

void test("FormState classes and re-exported types fail", () => {
  assert.ok(rules(withFile("class SearchFormState {}\n")).includes("form-state-class"));
  assert.ok(
    rules(withFile('export type { Chapter } from "@paperback/types";\n')).includes(
      "reexport-types",
    ),
  );
});

void test("the same URL constant in two files fails", () => {
  const root = makeRepo({
    "src/Demo/models.ts": `${HEADER}export const DOMAIN = "https://demo.example";\n`,
    "src/Demo/network.ts": `${HEADER}const BASE_URL = "https://demo.example/";\n`,
  });
  assert.ok(rules(root).includes("duplicate-url-constant"));
});

void test("a missing or customised test file fails", () => {
  assert.ok(rules(makeRepo({ "src/tests/Demo.ts": null })).includes("test-file"));
  assert.ok(
    rules(
      makeRepo({
        "src/tests/Demo.ts": TEST_FILE.replace(
          "sourceInfo);",
          'sourceInfo, { searchResultsProviding: { getSearchResults: [{ title: "x" }] } });',
        ),
      }),
    ).includes("test-file"),
  );
  assert.ok(
    rules(
      makeRepo({
        "src/tests/Demo.ts": TEST_FILE.replace(
          "await suite.run",
          'suite.test("x", async () => {});\n  await suite.run',
        ),
      }),
    ).includes("test-file"),
  );
});

void test("pbconfig version, language and main export are checked", () => {
  assert.ok(
    rules(
      makeRepo({
        "src/Demo/pbconfig.ts": `${HEADER}export default { version: "1.0.0", language: "en" };\n`,
      }),
    ).includes("pbconfig-version"),
  );
  assert.ok(
    rules(
      makeRepo({
        "src/Demo/pbconfig.ts": `${HEADER}export default { version: "1.0.0-alpha.1", language: "EN" };\n`,
      }),
    ).includes("pbconfig-language"),
  );
  assert.ok(
    rules(
      makeRepo({ "src/Demo/main.ts": `${HEADER}export const DemoSource = new DemoExtension();\n` }),
    ).includes("main-export"),
  );
});

void test("a non-square icon and a missing README entry fail", () => {
  const wide = Buffer.from(PNG);
  wide.writeUInt32BE(128, 16);
  assert.ok(rules(makeRepo({ "src/Demo/static/icon.png": wide })).includes("icon"));
  assert.ok(rules(makeRepo({ "README.md": "nothing here\n" })).includes("readme"));
});

void test("a missing SPDX header fails", () => {
  assert.ok(rules(makeRepo({ "src/Demo/parsers.ts": "export const a = 1;\n" })).includes("spdx"));
});

void test("a changed source without a version bump fails against a base", () => {
  const root = makeRepo();
  const run = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  run("init", "-q");
  run("-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
  run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  fs.appendFileSync(path.join(root, "src/Demo/main.ts"), "// changed\n");
  assert.ok(checkSource(root, "Demo", { base: "HEAD" }).some((f) => f.rule === "version-bump"));
  fs.writeFileSync(
    path.join(root, "src/Demo/pbconfig.ts"),
    `${HEADER}export default { version: "1.0.0-alpha.2", language: "en" };\n`,
  );
  assert.ok(!checkSource(root, "Demo", { base: "HEAD" }).some((f) => f.rule === "version-bump"));
});

void test("an undefined value inside Metadata fails; ending paging with metadata undefined passes", () => {
  const form = (body) => withFile(`class F { getSearchQueryMetadata() { return { ${body} }; } }\n`);
  assert.ok(rules(form("status: this.status || undefined")).includes("metadata-undefined"));
  assert.ok(rules(form("genres: g.length ? g : undefined")).includes("metadata-undefined"));
  assert.ok(
    rules(withFile("const r = { items, metadata: { page: next ?? undefined } };\n")).includes(
      "metadata-undefined",
    ),
  );
  assert.ok(
    !rules(withFile("const r = { items, metadata: hasMore ? { page } : undefined };\n")).includes(
      "metadata-undefined",
    ),
  );
  assert.ok(
    !rules(withFile("const c = { chapterId, title: t || undefined };\n")).includes(
      "metadata-undefined",
    ),
  );
});

void test("timers, object bodies, empty-string state, item casts and text codecs are notes", () => {
  const notes = (body) =>
    checkSource(withFile(body), "Demo")
      .filter((f) => f.level === "N")
      .map((f) => f.rule);
  assert.ok(notes("await new Promise((r) => setTimeout(r, 10));\n").includes("timer"));
  assert.ok(
    notes("scheduleRequest({ url, method: 'POST', body: { page: 0 } });\n").includes("object-body"),
  );
  assert.ok(
    !notes(
      "scheduleRequest({ url, method: 'POST', body: JSON.stringify({ page: 0 }) });\n",
    ).includes("object-body"),
  );
  assert.ok(notes('Application.setState("", KEY);\n').includes("empty-state"));
  assert.ok(notes("const i = x as DiscoverSectionItem;\n").includes("item-cast"));
  assert.ok(notes("const t = new TextDecoder().decode(b);\n").includes("text-codec"));
});

void test("a class of only static members fails; an interceptor with instance members passes", () => {
  assert.ok(
    rules(withFile("export class Api {\n  static get(u: string) { return u; }\n}\n")).includes(
      "static-class",
    ),
  );
  assert.ok(
    !rules(
      withFile(
        "export class Demo extends PaperbackInterceptor {\n  async interceptRequest(r) { return r; }\n}\n",
      ),
    ).includes("static-class"),
  );
});

void test("a pbconfig name with spaces and non-array capabilities fail", () => {
  const config = (body) =>
    makeRepo({
      "src/Demo/pbconfig.ts": `${HEADER}export default { version: "1.0.0-alpha.1", ${body} };\n`,
    });
  assert.ok(rules(config('name: "Punk Records",')).includes("pbconfig-name"));
  assert.ok(!rules(config('name: "PunkRecords",')).includes("pbconfig-name"));
  assert.ok(
    rules(
      config(
        "capabilities: SourceIntents.CHAPTER_PROVIDING | SourceIntents.SEARCH_RESULT_PROVIDING,",
      ),
    ).includes("pbconfig-capabilities"),
  );
  assert.ok(
    !rules(config("capabilities: [SourceIntents.CHAPTER_PROVIDING],")).includes(
      "pbconfig-capabilities",
    ),
  );
});

void test("a change to src/utils selects the sources that import it", () => {
  const root = makeRepo({
    "src/Other/pbconfig.ts": "x\n",
    "src/Other/main.ts": "x\n",
    "src/Demo/parsers.ts": `${HEADER}import { getState } from "../utils/state";\n`,
  });
  const run = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: root,
      stdio: "ignore",
    });
  run("init", "-q");
  run("add", ".");
  run("commit", "-qm", "base");
  fs.mkdirSync(path.join(root, "src/utils"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/utils/state.ts"), "export const getState = 1;\n");
  assert.deepEqual(changedSources(root, "HEAD"), ["Demo"]);
});
