#!/usr/bin/env node
// Scaffolds a source in the shape inkdex merges: canonical files with license headers, a
// pbconfig with a name matching the directory, the generated baseline test, and a wiki page.
// It writes no placeholder icon: add the site's square logo as static/icon.png.
//
//   npm run new-source -- <Name> <https://site> [--novel] [--language en]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const HEADER = "/* SPDX-License-Identifier: GPL-3.0-or-later */\n/* Copyright © 2026 Inkdex */\n";

export function scaffold(root, { name, url, novel = false, language = "en" }) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name))
    throw new Error(`${name}: use PascalCase with no spaces (it is the installed id)`);
  const origin = new URL(url);
  if (origin.protocol !== "https:") throw new Error(`${url}: use the https:// home page`);
  if (!/^(multi|[a-z]{2,3}(-[a-z0-9]{2,8})*)$/.test(language))
    throw new Error(`${language}: use a lowercase IETF tag or multi`);
  const dir = path.join(root, "src", name);
  if (fs.existsSync(dir)) throw new Error(`src/${name} already exists`);

  const domain = `${origin.protocol}//${origin.host}`;
  const badges = novel
    ? '[{ label: "Novel", textColor: "#ffffff", backgroundColor: "#3baf4b" }]'
    : "[]";
  const files = {
    "pbconfig.ts": `${HEADER}
import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "${name}",
  description: "Extension that pulls content from ${origin.host}.",
  version: "1.0.0-alpha.1",
  icon: "icon.png",
  language: "${language}",
  contentRating: ContentRating.EVERYONE,
  capabilities: [SourceIntents.CHAPTER_PROVIDING, SourceIntents.SEARCH_RESULT_PROVIDING],
  badges: ${badges},
  developers: [{ name: "Popmango", github: "https://github.com/PoppingMangoSources" }],
} satisfies ExtensionInfo;
`,
    "models.ts": `${HEADER}
export const DOMAIN = "${domain}";
`,
    "network.ts": `${HEADER}
import { BasicRateLimiter, PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { DOMAIN } from "./models";

export class ${name}Interceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: \`\${DOMAIN}/\`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(_request: Request, _response: Response, data: ArrayBuffer): Promise<ArrayBuffer> {
    return data;
  }
}

// Balanced preset from the inkdex guidelines; tune it to what the site tolerates.
export const rateLimiter = new BasicRateLimiter("${name.toLowerCase()}", {
  numberOfRequests: 3,
  bufferInterval: 1,
  ignoreImages: true,
});

export const fetchText = async (url: string): Promise<string> => {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status !== 200) throw new Error(\`${name} answered \${response.status} for \${url}\`);
  return Application.arrayBufferToUTF8String(data);
};
`,
    "main.ts": `${HEADER}
import type {
  Chapter,
  ChapterDetails,
  ExtensionImpl,
  Metadata,
  PagedResults,
  SearchQuery,
  SearchResultItem,
  SourceManga,
} from "@paperback/types";

import { ${name}Interceptor, rateLimiter } from "./network";
import type ${name}Config from "./pbconfig";

// Each method below is wired to the site after recon; see the paperback-extension skill.
export class ${name}Extension implements ExtensionImpl<typeof ${name}Config> {
  interceptor = new ${name}Interceptor("main");

  async initialise(): Promise<void> {
    rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSearchResults(_query: SearchQuery<Metadata>): Promise<PagedResults<SearchResultItem>> {
    throw new Error("${name}: search is not implemented yet");
  }

  async getMangaDetails(_mangaId: string): Promise<SourceManga> {
    throw new Error("${name}: details are not implemented yet");
  }

  async getChapters(_sourceManga: SourceManga): Promise<Chapter[]> {
    throw new Error("${name}: chapters are not implemented yet");
  }

  async getChapterDetails(_chapter: Chapter): Promise<ChapterDetails> {
    throw new Error("${name}: the reader is not implemented yet");
  }
}

export const ${name} = new ${name}Extension();
`,
  };
  fs.mkdirSync(path.join(dir, "static"), { recursive: true });
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);

  const wiki = path.join(root, "docs/sources", `${name}.md`);
  fs.mkdirSync(path.dirname(wiki), { recursive: true });
  if (!fs.existsSync(wiki)) {
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      wiki,
      `---
title: ${name}
type: subsystem
created: ${today}
updated: ${today}
sources:
  - code: src/${name}/
  - ext: ${domain}
verified_at: pending
---

# ${name}

${origin.host}: what the site serves and the traps in it. Recon goes here before code.

## Endpoints

| Capability | Request | Fields / selectors | Paging |
| --- | --- | --- | --- |

## Ids

## Traps
`,
    );
  }
  return [...Object.keys(files).map((file) => `src/${name}/${file}`), `docs/sources/${name}.md`];
}

function main(argv) {
  const positional = argv.filter((arg, i) => !arg.startsWith("--") && argv[i - 1] !== "--language");
  const [name, url] = positional;
  if (!name || !url) {
    console.error("usage: npm run new-source -- <Name> <https://site> [--novel] [--language en]");
    return 2;
  }
  const language = argv.includes("--language") ? argv[argv.indexOf("--language") + 1] : "en";
  const created = scaffold(ROOT, { name, url, novel: argv.includes("--novel"), language });
  execFileSync("npx", ["paperback-cli", "test", "--generate", name], {
    cwd: ROOT,
    stdio: "ignore",
  });
  const testFile = path.join(ROOT, "src/tests", `${name}.ts`);
  fs.writeFileSync(testFile, HEADER + "\n" + fs.readFileSync(testFile, "utf8").trimStart());
  execFileSync("npx", ["oxfmt", `src/${name}`, `src/tests/${name}.ts`, `docs/sources/${name}.md`], {
    cwd: ROOT,
    stdio: "ignore",
  });
  console.log(`Created ${[...created, `src/tests/${name}.ts`].join(", ")}.`);
  console.log(
    `Next: add the site's square logo as src/${name}/static/icon.png, do the recon in docs/sources/${name}.md,`,
  );
  console.log("set contentRating and capabilities, and add this README row:");
  console.log(
    `| <img src="https://cdn.jsdelivr.net/gh/PoppingMangoSources/general-extensions-mangago@0.9%2Ftest/media/sources/${name.toLowerCase()}.png" width="22" align="top"/> **${name}** | [${new URL(url).host}](${new URL(url).origin}) |`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
