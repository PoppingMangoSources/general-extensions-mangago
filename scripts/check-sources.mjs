#!/usr/bin/env node
// Checks the source rules that need no network. FAIL rules come from inkdex review comments
// or deprecations in @paperback/types; NOTE rules are judgement calls that merged sources
// disagree on, so they print without failing. See .claude/skills/paperback-extension/references/standards.md.
//
//   node scripts/check-sources.mjs [Name...]          check named sources (all when none given)
//   node scripts/check-sources.mjs --base <ref>       check sources changed since <ref>, and their version bump
//   node scripts/check-sources.mjs --root <dir>       check another checkout (an inkdex clone, for calibration)
//   node scripts/check-sources.mjs --calibrate        count findings per rule, never fail
//   node scripts/check-sources.mjs --json             machine-readable findings

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CANONICAL_SAFE_ID = "/[^a-zA-Z0-9._\\-@()[\\]%?#+=/&:]/g";
const TOP_LEVEL = new Set([
  "main.ts",
  "models.ts",
  "network.ts",
  "parsers.ts",
  "forms.ts",
  "forms",
  "utils.ts",
  "utils",
  "pbconfig.ts",
  "static",
  "implementations",
  "services",
]);
const DEPRECATED = [
  [
    /\bsaveCloudflareBypassCookies\b/,
    "saveCloudflareBypassCookies is deprecated: use cloudflareBypassCompleted",
  ],
  [
    /\bregisterDiscoverSection\s*\(/,
    "Application.registerDiscoverSection is deprecated: return sections from getDiscoverSections",
  ],
  [
    /@paperback\/types\/lib\/compat\/0\.8/,
    "the 0.8 compat shim is a migration aid: use the native 0.9 forms",
  ],
  [
    /SourceIntents\.(MANGA_CHAPTERS|MANGA_PROGRESS|MANGA_PROGRESS_PROVIDING|DISCOVER_SECIONS|DISCOVER_SECIONS_PROVIDING|COLLECTION_MANAGEMENT|CLOUDFLARE_BYPASS_REQUIRED|SETTINGS_UI|MANGA_SEARCH|SEARCH_RESULTS_PROVIDING)\b/,
    "deprecated SourceIntents name: use the *_PROVIDING name the types recommend",
  ],
  [
    /\b(getManagedLibraryCollections|commitManagedCollectionChanges|getSourceMangaInManagedCollection|PartialLibraryItem|LibraryItemSourceLinkProposal|ManagedCollectionChangeset)\b/,
    "removed in types alpha.93: use getManagedCollections, getManagedCollectionItems and applyManagedCollectionChanges",
  ],
];

export const RULES = {
  structure: "F",
  icon: "F",
  "icon-name": "N",
  "main-export": "F",
  "pbconfig-version": "F",
  "pbconfig-language": "F",
  "version-bump": "F",
  "test-file": "F",
  readme: "F",
  spdx: "F",
  console: "F",
  any: "F",
  deprecated: "F",
  divider: "F",
  "rethrow-string": "F",
  "empty-catch": "F",
  "device-global": "F",
  // kodama found no timers on the device, yet merged Mangago paces reads with setTimeout: verify.
  timer: "N",
  "static-class": "F",
  "pbconfig-name": "F",
  "pbconfig-capabilities": "F",
  "raw-fetch": "F",
  // The toolchain's test VM labels TextDecoder/TextEncoder "provided by the app", but no device
  // probe confirms it and merged sources use Application.arrayBufferToUTF8String.
  "text-codec": "N",
  // A production crash in kodama's repository; no merged inkdex source does it.
  "metadata-undefined": "F",
  "empty-image-url": "F",
  "object-body": "N",
  "empty-state": "N",
  "item-cast": "N",
  "safe-id-regex": "F",
  // Deprecated in the types, yet niclimcy's own MangaFire (October 2026) still passes `options`
  // and flag emoji in its language picker, so these are notes until a review asks.
  "select-row-options": "N",
  emoji: "N",
  "form-state-class": "F",
  "reexport-types": "F",
  "duplicate-url-constant": "F",
  "status-range": "N",
  "parse-time-date": "N",
  "fan-out": "N",
  layout: "N",
  "single-file-dir": "N",
  "mixed-declarations": "N",
  "set-state-order": "N",
};

// Blanks comments and string contents so code rules cannot match inside a WebView script
// string or a comment, and vice versa. Offsets and newlines are preserved.
export function splitSource(text) {
  const code = text.split("");
  const strings = Array.from(text, (c) => (c === "\n" ? "\n" : " "));
  const comments = strings.slice();
  const blank = (i) => {
    if (code[i] !== "\n") code[i] = " ";
  };
  const braces = [];
  let i = 0;
  let lastSignificant = "";
  const regexAllowed = () =>
    lastSignificant === "" ||
    "(,=:[!&|?{};+-*%<>~^".includes(lastSignificant) ||
    /return$|typeof$|case$/.test(text.slice(Math.max(0, i - 7), i).trimEnd());

  const readQuoted = (quote) => {
    blank(i);
    i++;
    while (i < text.length && text[i] !== quote && text[i] !== "\n") {
      if (text[i] === "\\") {
        strings[i] = text[i];
        blank(i);
        i++;
      }
      strings[i] = text[i];
      blank(i);
      i++;
    }
    blank(i);
    i++;
  };

  // Reads template text up to the closing backtick or the next `${`, whose expression is code.
  const readTemplateText = () => {
    while (i < text.length && text[i] !== "`") {
      if (text[i] === "$" && text[i + 1] === "{") {
        braces.push("template");
        i += 2;
        return;
      }
      if (text[i] === "\\") {
        strings[i] = text[i];
        blank(i);
        i++;
      }
      strings[i] = text[i];
      blank(i);
      i++;
    }
    blank(i);
    i++;
  };

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        comments[i] = text[i];
        blank(i);
        i++;
      }
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) {
        comments[i] = text[i];
        blank(i);
      }
    } else if (c === '"' || c === "'") {
      readQuoted(c);
      lastSignificant = "a";
    } else if (c === "`") {
      blank(i);
      i++;
      readTemplateText();
      lastSignificant = "a";
    } else if (c === "/" && regexAllowed()) {
      let inClass = false;
      i++;
      while (i < text.length && text[i] !== "\n" && (inClass || text[i] !== "/")) {
        if (text[i] === "\\") i++;
        else if (text[i] === "[") inClass = true;
        else if (text[i] === "]") inClass = false;
        i++;
      }
      i++;
      lastSignificant = "a";
    } else if (c === "{") {
      braces.push("code");
      lastSignificant = c;
      i++;
    } else if (c === "}") {
      i++;
      if (braces.pop() === "template") readTemplateText();
      lastSignificant = "}";
    } else {
      if (!/\s/.test(c)) lastSignificant = /[\w$]/.test(c) ? "a" : c;
      i++;
    }
  }
  return { code: code.join(""), strings: strings.join(""), comments: comments.join("") };
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function* matches(text, regex) {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const global = new RegExp(regex.source, flags);
  let match;
  while ((match = global.exec(text))) {
    yield match;
    if (match[0] === "") global.lastIndex++;
  }
}

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return undefined;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const git = (root, ...args) => {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
};

const readVersion = (text) => text?.match(/\bversion:\s*["'`]([^"'`]+)["'`]/)?.[1];

export function checkSource(root, name, { base } = {}) {
  const findings = [];
  const dir = path.join(root, "src", name);
  const add = (rule, file, line, message) =>
    findings.push({
      level: RULES[rule],
      rule,
      source: name,
      file: file ? path.relative(root, file) : `src/${name}`,
      line,
      message,
    });

  const configFile = path.join(dir, "pbconfig.ts");
  const config = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : undefined;
  const iconName = config?.match(/\bicon:\s*["'`]([^"'`]+)["'`]/)?.[1] ?? "icon.png";
  for (const required of ["main.ts", "pbconfig.ts", `static/${iconName}`]) {
    if (!fs.existsSync(path.join(dir, required)))
      add("structure", undefined, undefined, `missing ${required}`);
  }
  if (iconName !== "icon.png")
    add(
      "icon-name",
      configFile,
      undefined,
      `icon "${iconName}": every merged source ships static/icon.png`,
    );

  const icon = path.join(dir, "static", iconName);
  if (fs.existsSync(icon)) {
    const size = pngSize(icon);
    if (!size) add("icon", icon, undefined, "icon.png is not a PNG");
    else if (size.width !== size.height)
      add(
        "icon",
        icon,
        undefined,
        `icon is ${size.width}x${size.height}; inkdex requires a square PNG`,
      );
  }

  const mainFile = path.join(dir, "main.ts");
  if (
    fs.existsSync(mainFile) &&
    !new RegExp(`export const ${name} = new \\w+\\(`).test(fs.readFileSync(mainFile, "utf8"))
  ) {
    add(
      "main-export",
      mainFile,
      undefined,
      `main.ts must export \`export const ${name} = new ${name}Extension()\` (the const names the directory)`,
    );
  }

  if (config) {
    const version = readVersion(config);
    if (!version || !/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)) {
      add(
        "pbconfig-version",
        configFile,
        undefined,
        `version ${JSON.stringify(version)} is not <major>.<minor>.<patch>-alpha.<n>`,
      );
    }
    const language = config.match(/\blanguage:\s*["'`]([^"'`]*)["'`]/)?.[1];
    if (language !== undefined && !/^(multi|[a-z]{2,3}(-[a-z0-9]{2,8})*)$/.test(language)) {
      add(
        "pbconfig-language",
        configFile,
        undefined,
        `language "${language}" must be a lowercase IETF tag or "multi"`,
      );
    }
    const displayName = config.match(/\bname:\s*["'`]([^"'`]*)["'`]/)?.[1];
    if (displayName !== undefined && /\s/.test(displayName)) {
      add(
        "pbconfig-name",
        configFile,
        undefined,
        `name "${displayName}" has spaces: inkdex names have none and match the directory (celarye, #186)`,
      );
    }
    const capabilities = config.match(/\bcapabilities:\s*([^\n]*)/)?.[1];
    if (capabilities !== undefined && !capabilities.trimStart().startsWith("[")) {
      add(
        "pbconfig-capabilities",
        configFile,
        undefined,
        "capabilities must be an array of SourceIntents (#230)",
      );
    }
    if (base) {
      const changed = git(
        root,
        "diff",
        "--name-only",
        base,
        "--",
        `src/${name}`,
        `src/tests/${name}.ts`,
      )?.trim();
      const previous = git(root, "show", `${base}:src/${name}/pbconfig.ts`);
      if (changed && previous !== undefined && readVersion(previous) === version) {
        add(
          "version-bump",
          configFile,
          undefined,
          `changed since ${base} but version is still ${version}: bump the alpha number`,
        );
      }
    }
  }

  const testFile = path.join(root, "src/tests", `${name}.ts`);
  if (!fs.existsSync(testFile)) {
    add(
      "test-file",
      testFile,
      undefined,
      `missing; generate it with \`npx paperback-cli test --generate ${name}\` (paperback-cli skips a source with no test file and still reports success)`,
    );
  } else {
    const { code } = splitSource(fs.readFileSync(testFile, "utf8"));
    const calls = [...matches(code, /registerDefaultTests\s*\(([^)]*)\)/)];
    if (
      /\bsuite\.test\s*\(/.test(code) ||
      calls.length !== 1 ||
      calls[0][1].split(",").filter((arg) => arg.trim()).length !== 3
    ) {
      add(
        "test-file",
        testFile,
        undefined,
        "test file must be the generated baseline: one registerDefaultTests(suite, Source, sourceInfo) call, no custom cases or seeded inputs",
      );
    }
  }

  // The README lists a source by its display name ("Scans.GG"), which may differ from the id.
  const readme = path.join(root, "README.md");
  const shownAs = fs.existsSync(configFile)
    ? fs.readFileSync(configFile, "utf8").match(/\bname:\s*["'`]([^"'`]*)["'`]/)?.[1]
    : undefined;
  if (fs.existsSync(readme)) {
    const text = fs.readFileSync(readme, "utf8");
    if (!text.includes(name) && !(shownAs && text.includes(shownAs)))
      add("readme", readme, undefined, `README.md does not list ${name}`);
  }

  if (!fs.existsSync(dir)) return findings;

  for (const entry of fs.readdirSync(dir)) {
    if (!TOP_LEVEL.has(entry))
      add(
        "layout",
        path.join(dir, entry),
        undefined,
        `"${entry}" is outside the canonical file set (main/models/network/parsers/forms/utils/pbconfig/static)`,
      );
  }
  for (const sub of walk(dir).map((file) => path.dirname(file))) {
    const base = path.basename(sub);
    if (["utils", "forms"].includes(base) && fs.readdirSync(sub).length === 1) {
      add("single-file-dir", sub, undefined, `${base}/ holds one file: use ${base}.ts`);
    }
  }

  const urlConstants = new Map();
  const files = walk(dir).filter((file) => file.endsWith(".ts"));
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const { code, strings, comments } = splitSource(text);
    const at = (index) => lineOf(text, index);
    const relative = path.relative(dir, file);

    if (!text.startsWith("/* SPDX-License-Identifier: GPL-3.0-or-later */")) {
      add(
        "spdx",
        file,
        1,
        "missing the `/* SPDX-License-Identifier: GPL-3.0-or-later */` + copyright header",
      );
    }
    for (const m of matches(code, /\b(?:imageUrl|thumbnailUrl)\s*:/)) {
      if (/^[^:]+:\s*(["'`])\1/.test(text.slice(m.index)))
        add(
          "empty-image-url",
          file,
          at(m.index),
          "the native bridge rejects empty image URLs: use an absolute site fallback or omit the card",
        );
    }
    for (const m of matches(code, /\bconsole\.(log|error|warn|info|debug)\s*\(/))
      add(
        "console",
        file,
        at(m.index),
        "remove console logging; throw errors the user needs instead",
      );
    for (const m of matches(code, /Cheerio<\s*any\s*>|:\s*any\b|\bas\s+any\b|<any>/))
      add("any", file, at(m.index), "no `any`: type it (cheerio.Cheerio<AnyNode> for selections)");
    for (const [regex, message] of DEPRECATED)
      for (const m of matches(code, regex)) add("deprecated", file, at(m.index), message);
    for (const m of matches(code, /\bSelectRow\s*\(/)) {
      let depth = 0;
      let end = m.index + m[0].length - 1;
      for (; end < code.length; end++) {
        if (code[end] === "(") depth++;
        else if (code[end] === ")" && --depth === 0) break;
      }
      const options = /\boptions\s*:/.exec(code.slice(m.index, end));
      if (options)
        add(
          "select-row-options",
          file,
          at(m.index + options.index),
          "SelectRow `options` is deprecated: use `items` with `layout`",
        );
    }
    for (const m of matches(comments, /\/\/\s*[-=*#~_]{4,}|\/\*+\s*[-=*#~_]{4,}/))
      add("divider", file, at(m.index), "no decorative divider comments");
    for (const m of matches(
      code,
      /catch\s*\(\s*(\w+)\s*\)\s*\{\s*throw\s+new\s+Error\s*\(\s*String\s*\(\s*\1\s*\)\s*\)/,
    )) {
      add(
        "rethrow-string",
        file,
        at(m.index),
        "a catch that only rethrows String(error) hides the original: delete the try/catch",
      );
    }
    // A commented empty catch around optional data (JSON-LD, a decode) is merged upstream (Roliascan).
    for (const m of matches(code, /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/)) {
      if (!comments.slice(m.index, m.index + m[0].length).trim()) {
        add(
          "empty-catch",
          file,
          at(m.index),
          "empty catch swallows failures (and CloudflareError): rethrow, or say in a comment why the data is optional",
        );
      }
    }
    // crypto.subtle exists on the device (bridged); constructing SubtleCrypto throws.
    for (const m of matches(code, /\bnew\s+(Array|SubtleCrypto)\s*\(/)) {
      add(
        "device-global",
        file,
        at(m.index),
        `${m[0].trim()} fails lint or on the device: use Array.from or the global crypto.subtle`,
      );
    }
    for (const m of matches(code, /\bnew\s+(TextDecoder|TextEncoder)\s*\(/)) {
      add(
        "text-codec",
        file,
        at(m.index),
        "prefer Application.arrayBufferToUTF8String; a TextDecoder on the device is unverified",
      );
    }
    for (const m of matches(code, /(?<![\w.$])(setTimeout|setInterval|setImmediate)\s*\(/)) {
      add(
        "timer",
        file,
        at(m.index),
        `${m[1]} was absent on a device (kodama) though merged Mangago calls it: prefer Application.sleep(seconds) or the limiter, and verify on a device`,
      );
    }
    for (const m of matches(code, /\bclass\s+(\w+)\s*\{/)) {
      const body = code.slice(m.index + m[0].length, code.indexOf("\n}", m.index));
      if (
        /\bstatic\b/.test(body) &&
        !/^\s+(?!static\b)(private\s+|public\s+|protected\s+|readonly\s+|async\s+)*\w+\s*[(=:]/m.test(
          body,
        )
      ) {
        add(
          "static-class",
          file,
          at(m.index),
          `class ${m[1]} only holds static members: use free functions (celarye)`,
        );
      }
    }
    // Decoded structs (Chapter, SearchResultItem) and `metadata: undefined` (end of paging, used by
    // 20 merged sources) are fine; an undefined value inside a Metadata object crashes the bridge.
    const metadataSpans = [
      ...matches(code, /\bgetSearchQueryMetadata\s*\([^)]*\)[^{]*\{/),
      ...matches(code, /\bmetadata\??:\s*\{/),
    ].map((m) => {
      let depth = 0;
      let end = m.index + m[0].length - 1;
      for (; end < code.length; end++) {
        if (code[end] === "{") depth++;
        else if (code[end] === "}" && --depth === 0) break;
      }
      return [m.index, end];
    });
    // `key: undefined`, `key: x || undefined`, `key: x ?? undefined`, `key: c ? x : undefined`.
    for (const m of matches(code, /:\s*[^,;{}\n]*\bundefined\b/)) {
      if (metadataSpans.some(([start, end]) => m.index > start && m.index < end)) {
        add(
          "metadata-undefined",
          file,
          at(m.index),
          "Metadata crosses the bridge raw and an undefined value crashes the app: omit the key",
        );
      }
    }
    for (const m of matches(code, /\bbody:\s*\{/)) {
      add(
        "object-body",
        file,
        at(m.index),
        "the bridge encodes object bodies and turns 0 into false: send JSON.stringify(body)",
      );
    }
    for (const m of matches(text, /\bsetState\(\s*["'`]{2}\s*,/)) {
      add(
        "empty-state",
        file,
        at(m.index),
        'clear a setting with setState(undefined, key), not "" (celarye, #196)',
      );
    }
    for (const m of matches(code, /\bas\s+DiscoverSectionItem\b/)) {
      add(
        "item-cast",
        file,
        at(m.index),
        "build the exact DiscoverSectionItem variant; a cast hides fields the app ignores",
      );
    }
    for (const m of matches(
      code,
      /(?<![\w.$])(fetch|XMLHttpRequest)\s*\(|\bnew\s+XMLHttpRequest\b/,
    ))
      add(
        "raw-fetch",
        file,
        at(m.index),
        "route every request through Application.scheduleRequest",
      );
    for (const m of matches(text, /SAFE_ID_REGEX\s*=\s*(\/.+\/[a-z]*)\s*;/)) {
      if (m[1] !== CANONICAL_SAFE_ID)
        add(
          "safe-id-regex",
          file,
          at(m.index),
          `SAFE_ID_REGEX must be byte-identical to ${CANONICAL_SAFE_ID}`,
        );
    }
    for (const m of matches(
      strings,
      /\p{Emoji_Presentation}|\p{Regional_Indicator}|\p{Extended_Pictographic}️/u,
    )) {
      add(
        "emoji",
        file,
        at(m.index),
        `emoji "${m[0]}" in a string: write functional text (Locked, English); ★ beside a number is fine`,
      );
    }
    for (const m of matches(code, /\bclass\s+\w*FormState\b/))
      add(
        "form-state-class",
        file,
        at(m.index),
        "the FormState class pattern is no longer accepted: keep state in the form",
      );
    for (const m of matches(
      text,
      /export\s+(type\s+)?(\{[^}]*\}|\*)\s+from\s+["']@paperback\/types["']/,
    ))
      add(
        "reexport-types",
        file,
        at(m.index),
        "do not re-export @paperback/types: import them directly",
      );
    for (const m of matches(
      text,
      /\bconst\s+[A-Z][A-Z0-9_]*\s*=\s*["'`](https?:\/\/[^"'`$]+)["'`]/,
    )) {
      const url = m[1].replace(/\/$/, "");
      urlConstants.set(url, [...(urlConstants.get(url) ?? []), `${relative}:${at(m.index)}`]);
    }
    for (const m of matches(code, /status\s*(>=|<)\s*200|status\s*(<|>=)\s*300/))
      add("status-range", file, at(m.index), "merged sources compare `response.status !== 200`");
    if (path.basename(file) === "parsers.ts") {
      for (const m of matches(code, /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/))
        add(
          "parse-time-date",
          file,
          at(m.index),
          "a parse-time date re-sorts the list on every refresh: use the site's date or a persisted anchor",
        );
    }
    for (const m of matches(code, /Promise\.all\s*\(\s*[\w.$]+\s*\.map\s*\(/))
      add(
        "fan-out",
        file,
        at(m.index),
        "Promise.all over a mapped list: confirm this is not one detail request per card",
      );
    const arrow = /^export\s+const\s+\w+\s*=\s*(async\s*)?\(/m.test(code);
    const declared = /^export\s+(async\s+)?function\s+\w+/m.test(code);
    if (arrow && declared)
      add(
        "mixed-declarations",
        file,
        undefined,
        "mixes exported arrow constants and function declarations: keep one form per file",
      );
    for (const m of matches(
      text,
      /\bsetState\(\s*["'`]([a-z][\w-]*_[\w-]*)["'`]\s*,\s*(?!["'`])/,
    )) {
      add(
        "set-state-order",
        file,
        at(m.index),
        `setState("${m[1]}", …) looks like key-first: the signature is setState(value, key)`,
      );
    }
  }
  for (const [url, places] of urlConstants) {
    if (places.length > 1)
      add(
        "duplicate-url-constant",
        path.join(dir, places[0].split(":")[0]),
        undefined,
        `${url} is defined in ${places.join(", ")}: define it once in models.ts`,
      );
  }
  return findings;
}

export function listSources(root) {
  const src = path.join(root, "src");
  return fs
    .readdirSync(src)
    .filter(
      (entry) =>
        !["tests", "utils"].includes(entry) && fs.existsSync(path.join(src, entry, "pbconfig.ts")),
    )
    .sort((a, b) => a.localeCompare(b));
}

export function changedSources(root, base) {
  const names = (git(root, "diff", "--name-only", base, "--", "src") ?? "").split("\n");
  names.push(
    ...(git(root, "ls-files", "--others", "--exclude-standard", "--", "src") ?? "").split("\n"),
  );
  const all = new Set(listSources(root));
  const changed = new Set();
  for (const name of names) {
    const parts = name.split("/");
    if (parts[0] !== "src") continue;
    const candidate = parts[1] === "tests" ? parts[2]?.replace(/\.ts$/, "") : parts[1];
    if (candidate && all.has(candidate)) changed.add(candidate);
  }
  // A change to shared code is a change to every source that imports it.
  if (names.some((name) => name.startsWith("src/utils/"))) {
    for (const source of all) {
      const files = walk(path.join(root, "src", source)).filter((file) => file.endsWith(".ts"));
      if (files.some((file) => /from\s+["'](\.\.\/)+utils\//.test(fs.readFileSync(file, "utf8")))) {
        changed.add(source);
      }
    }
  }
  return [...changed].sort((a, b) => a.localeCompare(b));
}

function main(argv) {
  const args = { names: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--root") args.root = argv[++i];
    else if (argv[i] === "--calibrate") args.calibrate = true;
    else if (argv[i] === "--json") args.json = true;
    else args.names.push(argv[i]);
  }
  const root = path.resolve(args.root ?? path.join(import.meta.dirname, ".."));
  const names = args.names.length
    ? args.names
    : args.base
      ? changedSources(root, args.base)
      : listSources(root);
  const findings = names.flatMap((name) => checkSource(root, name, { base: args.base }));

  if (args.calibrate) {
    const counts = {};
    for (const finding of findings) (counts[finding.rule] ??= new Set()).add(finding.source);
    console.log(`Calibration over ${names.length} sources in ${root}`);
    for (const rule of Object.keys(RULES)) {
      const hit = counts[rule] ? [...counts[rule]] : [];
      console.log(
        `  ${RULES[rule]} ${rule.padEnd(24)} ${String(hit.length).padStart(3)}  ${hit.join(" ")}`,
      );
    }
    return 0;
  }
  if (args.json) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    for (const f of findings) {
      console.log(
        `${f.level === "F" ? "FAIL" : "NOTE"} ${f.source} [${f.rule}] ${f.file}${f.line ? `:${f.line}` : ""}: ${f.message}`,
      );
    }
    const failed = findings.filter((f) => f.level === "F").length;
    console.log(
      `${names.length} source(s) checked: ${failed} failure(s), ${findings.length - failed} note(s).`,
    );
  }
  return findings.some((f) => f.level === "F") ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
