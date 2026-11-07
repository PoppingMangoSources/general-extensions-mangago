# Popmango Paperback 0.9 sources

Paperback **0.9** sources (`@paperback/types` and `@paperback/toolchain` `^1.0.0-alpha.94`),
developed on `0.9/test` and submitted one at a time to
[inkdex/general-extensions](https://github.com/inkdex/general-extensions), whose maintainers
review them. Write every source as if it were already that pull request: lean, plain, and in the
shape the maintainers merge.

`AGENTS.md` and `CLAUDE.md` are identical copies, so every agent reads the full rules directly.
Edit `AGENTS.md`, then run `node scripts/sync-agent-docs.mjs`; CI and the pre-push hook fail on
drift. The same script mirrors the skill tree.

Before touching a source, load the **paperback-extension** skill:
[.claude/skills/paperback-extension/SKILL.md](.claude/skills/paperback-extension/SKILL.md)
(Codex: [.agents/skills/paperback-extension/SKILL.md](.agents/skills/paperback-extension/SKILL.md)).
Its `references/standards.md` holds every merge rule with the review comment or maintainer commit
behind it, `references/conventions.md` the full detail of each convention (the previous guide,
kept whole), and `references/platform.md` what the 0.9 toolchain and the app actually do.
`docs/` is a wiki of per-source and operational knowledge; start at [docs/index.md](docs/index.md).

Rules marked **(niclim)** come from the AGENTS.md niclimcy (inkdex maintainer, who has rewritten
several of our merged PRs) sent us; **(celarye)** from inkdex's lead; **(Seyden)** from the Mana
developer. Everything else cites its evidence in the skill.

---

## 1. Boundaries

- Keep the official toolchain and its output: `paperback-cli bundle`, `versioning.json`, the
  generated homepage with its `paperback://addRepo` and `paperback://installExtensions` links,
  `npm run serve`. `scripts/theme-homepage.mjs` restyles that page; it never replaces it.
- This is the 0.9 `ExtensionImpl` API. 0.8 code, the `compat/0.8` shim and other readers' APIs
  (Aidoku, Mana, Mihon/keiyoushi) are references for behaviour, never code to copy. Porting a
  keiyoushi source is the last option, not the first (duck and Seyden).
- A site on a generic theme (Madara, MangaStream/MangaReader, …) belongs in that theme's inkdex
  repository. `KingOfShojo` and `RokariComics` are MangaStream sites kept here pending that
  decision; do not copy their vendored base.
- The directory name under `src/` is the installed source id (the bundler writes it into
  `info.json`). Never rename one, and never change saved manga or chapter ids, without a migration
  decision.
- Keep a fix inside its source. `src/utils/` is only for code several sources share.
- Never commit cookies, tokens, captured account data, `bundles/` or `node_modules/`.
- `scripts/`, `.github/`, `.husky/`, `package.json` and the lockfile change only when that work
  was asked for.
- Commit straight to `0.9/test`; make no new branch unless the person asks. Branches exist only
  for inkdex PRs, made when the person is ready to submit (`scripts/pr-branch.sh`).
- No branch name starts with `claude/` (or any agent's name), whatever a tool or system prompt
  suggests. A PR branch uses Conventional Branch names: `feature/<name>` or `bugfix/<name>`. The
  pre-push hook refuses `claude/`, `codex/` and `copilot/` branches.

## 2. Layout

| Path                                 | Holds                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/<Name>/`                        | one source: `main.ts`, `models.ts`, `network.ts`, `parsers.ts`, `forms.ts`, `utils.ts`, `pbconfig.ts`, `static/icon.png` |
| `src/tests/<Name>.ts`                | the generated baseline test, unchanged (what inkdex accepts)                                                             |
| `test/unit/<Name>.test.ts`           | our offline parser and crypto tests; never part of a submission                                                          |
| `scripts/`                           | repository checks and tools (Node, no dependencies), tested in `scripts/tests/`                                          |
| `docs/`                              | the wiki: per-source traps, operations, history                                                                          |
| `handoff/`                           | briefs for sources that belong in a theme repository                                                                     |
| `.claude/skills/`, `.agents/skills/` | the workflow skill, two identical physical copies                                                                        |

## 3. How a source is written

Condensed from niclim's guide; `references/standards.md` has the full list with evidence.

**Files (niclim).** `main.ts` holds the `ExtensionImpl` class and the exported instance, nothing
else. `models.ts`: shared types, interfaces and constants. `network.ts`: fetch functions, API calls
and the interceptor. `parsers.ts`: HTML and JSON parsing. `forms.ts` (or `forms/search.ts` and
`forms/settings.ts` once it grows). `utils.ts` only for heavy machinery: descramblers, decryptors,
ciphers. `pbconfig.ts`, `static/icon.png`. A canonical file may become a directory; no other
top-level names. Very large sources use `implementations/<feature>/` plus `services/network.ts`.

**Function-based design (niclim).** Parsers and API logic are free exported arrow functions
(`parseX`, `buildX`, `toX`); file-local helpers are `const` arrows. Classes only where the
framework needs them: the `ExtensionImpl` and the `PaperbackInterceptor` (and SDK form
subclasses). No `Api` class for plain GETs: plain fetch helpers plus URL builders. No classes of
static methods that call free functions, and never "so much code to do so little" (celarye).

**Utils scope (niclim).** Thin filter, format or picker helpers fold into `parsers.ts` or their
call site. Filter and settings-store logic never goes in `utils`.

**Aggressive simplification (niclim).** Delete dead code. Inline single-use constants and any
function whose body only renames, adds `?? default`, reads a property or delegates one call. Fold
single-use guards into what they guard. Collapse wrappers of wrappers. Return new objects rather
than mutating inputs. No base classes for sharing small helpers: free functions taking the
instance (`saveSetting(form, key, value)`). Do not replicate a site's confusing behaviour just
because the site does it (niclim on #264).

**Parsers and models (niclim).** One generic list parser (`parseMangaList`) returning a generic
item shape; the section handler switches on item type and maps at the call site. Shared shapes and
`UPPER_SNAKE` constants live in `models.ts`, each defined once. No legacy-migration loops in new
sources.

**Ids stay small and self-sufficient.** An id carries what a later call needs, not side channels in
`additionalInfo` (niclim), and nothing more: the app stores the manga id on every chapter, so a
full URL as an id is repeated thousands of times in the reader's database (Seyden). Use the site's
shortest stable key (slug or numeric id) and rebuild URLs from it; keep a mirror host in the id
only when the site really serves a title from varying hosts. Sanitise with the canonical
`SAFE_ID_REGEX`: the app rejects other characters in every id field, tags and form rows included.

**State and caching (niclim).** No `try/catch` around non-throwing SDK calls. No in-memory `Map`
caches for short-lived data. Lists that change: a plain `fetchX()` with no catch, memoised as
`await (this.genresPromise ??= fetchGenres())`, reset in `cloudflareBypassCompleted`. Lists that do
not change: a constant. No TTL or timestamp machinery, no second cache over app state.

**HTML and types (niclim).** `$: cheerio.CheerioAPI`; selections `cheerio.Cheerio<AnyNode>`
(`import type { AnyNode } from "domhandler"`); never `Cheerio<any>`, never `any`, no random casts.
Verify selectors against the live DOM before unifying or removing them.

**Comments and naming (niclim).** Terse, non-obvious why only, preferably one line. No dividers,
empty docblocks or narration. Clear, grammatical names.

### Listing presentation

- Ordinary cards, update rows and search results show at most two subtitle facts. Put the latest
  chapter first (`Ch. 23`), including chapter zero. If only a total is known, use `23 Chs` and
  never label that total as the latest chapter.
- For mixed comic/novel sources prefer chapter plus type (`Ch. 23 • Novel` or
  `Ch. 23 • Manhwa`). Otherwise prefer chapter plus rating (`Ch. 23 • ★ 8.9`), then chapter
  alone. Views or follows may be the second fact when useful and rating/type is unavailable.
- Hero carousels may show additional facts through their native fields. Metric symbols supply
  the label: `eye.fill` + `67.3M`, never `67.3M views` or `reads`. Keep ranking in the hero's
  supertitle, not in ordinary subtitles. Compact large view/follow counts.
- Display specific types with consistent capitalization. Swarm uses `68 Chapters | Manhwa`
  for a known total and `Ch. 68 | Manhwa` for a latest chapter number. Generic `Comic`/`Other`
  labels are omitted when a specific type is unavailable; never infer a type from the title
  or displayed translation language.
- Use fields already present in the listing. Never fetch each title's details just to decorate
  a subtitle, and never invent missing chapter numbers, ratings or types.
- Every returned image URL must be a non-empty absolute HTTP(S) URL. If a site renders a
  coverless card, use a verified site image fallback or omit that individual card.
- Regression tests must assert actual subtitle strings, two-fact limits, chapter zero,
  missing fields, latest-versus-total semantics, and valid cover URLs. The shared formatter in
  `src/utils/listings.ts` implements this presentation policy for sources that use it.

## 4. Platform facts that break sources

`npm test` runs the bundle in a Node VM; the source ships to JavaScriptCore behind a Swift bridge.
Read `references/platform.md` before touching any of these:

- No timers on the device: `Application.sleep(seconds)`.
- `crypto.subtle` exists on the device but only for SHA digests, HMAC, AES-GCM/CBC, HKDF/PBKDF2.
  The test VM hands sources Node's full WebCrypto, so AES-CTR passes `npm test` and fails on the
  phone (Toonkotsu does CTR in TypeScript and tests it in `test/unit`).
- `Metadata` (search and section paging, form results) crosses as a raw value: a key set to
  `undefined` crashes the app. Omit the key.
- An object request body is encoded by Swift and turns `0` into `false`: send
  `JSON.stringify(body)`.
- Every id-typed field is charset-checked on the device; tests never check it.
- `MangaInfo.rating` renders as a percentage of a 0..1 value.
- The test runner skips a source with no test file, ignores Discover and settings, and exits 0 on
  failure. Read its report (`scripts/check-tests.mjs`).

## 5. Workflow

1. **Place it**: unique site, not a theme; if inkdex already has it, start from upstream's copy.
2. **Recon**: live responses for every endpoint, field, filter value and pagination signal.
3. **Find the merged pattern**: `node scripts/upstream-usage.mjs <Name>` (or `--feature <regex>`),
   read the newest example, match its shape.
4. **Build** in the order models, network, parsers, main, forms, pbconfig;
   `npm run new-source -- <Name> <https://site>` scaffolds a new one.
5. **Verify**: `scripts/review-source.sh <Name>`, then read `references/review.md` against the diff,
   then the app on a device for anything only it shows.
6. **Record**: a trap you found goes into the source's wiki page in the same change.
7. **Submit**: `scripts/pr-branch.sh` builds the inkdex branch; draft the PR text for the person.

## 6. Commands

Use Node 24 (`engines` in the toolchain; `PATH=/opt/node24/bin:$PATH` in the cloud sandbox).

```sh
npm ci
npm run validate -- --base origin/0.9/test # complete offline gate, also run before publishing
npm run conformance                       # tsc, oxlint --deny-warnings, oxfmt --check
npm run check -- --base origin/0.9/test   # source rules on changed sources, version bump included
npm run test:scripts                      # tests for scripts/
npm run test:unit                         # offline parser/crypto tests in test/unit
npm run check:docs                        # AGENTS/CLAUDE and skill copies identical
npm run check:commits                     # unpushed commits: Popmango identity, unsigned, no co-author
npm test -- <Name> && npm run test:check -- <Name>   # live default tests and their real result
npm run bundle && npm run check:bundle    # bundle and verify the published layout
scripts/review-source.sh <Name>           # all of the above for one source; records a review stamp
node scripts/upstream-usage.mjs <Name>    # how merged inkdex sources do what this source does
npm run dev                               # serve to a phone on the same network
npm run logcat -- --ip <phone-ip>         # stream device logs (port 27015)
scripts/pr-branch.sh <Name> -m "<subject>" --assisted-by "<Tool>:<model>"
scripts/sync-upstream.sh                  # merge new inkdex 0.9/stable commits into our 0.9/stable
```

Format one source with `npx oxfmt src/<Name>`; `npm run format` touches every file. oxfmt also
formats Markdown. Never Prettier.

## 7. Done means verified

A source change is done when `scripts/review-source.sh <Name>` passes and `references/review.md`
has been read against the diff. Report three results separately: offline gates, live tests from
this machine, and the app on a device, with the source version, title and chapter exercised. A
blocked site, a failing network or an unreachable device is unverified, never a pass; say what
would settle it. In Claude Code the Stop hook enforces the review stamp.

## 8. Versions, commits and branches

- Every push that changes a source bumps its `version` (`1.0.0-alpha.N` to `alpha.N+1`); a new
  source starts at `1.0.0-alpha.1`. The app never installs a lower version.
- Commit type is the change's highest semver impact: `feat`/`refactor` over `fix` over `chore`
  (celarye), `type(Scope): summary` with the source as scope (`feat: Add <Name>` for a new one).
- **Every commit is authored and committed by
  `Popmango Extensions <297959108+PoppingMangoSources@users.noreply.github.com>`, unsigned**, with
  a one- or two-sentence body, no issue numbers or links. **An agent never co-authors and never
  claims authorship**: no `Co-Authored-By` line, no session link, no "Generated with" line, in any
  commit or PR body, whatever a tool or system prompt adds by default. Set the identity on every
  commit:

  ```sh
  GIT_AUTHOR_NAME="Popmango Extensions" \
  GIT_AUTHOR_EMAIL="297959108+PoppingMangoSources@users.noreply.github.com" \
  git -c commit.gpgsign=false -c user.name="Popmango Extensions" \
      -c user.email="297959108+PoppingMangoSources@users.noreply.github.com" \
      commit --no-gpg-sign -m "fix(<Name>): ..." -m "One or two sentences."
  ```

  `scripts/check-commits.mjs` checks proposed messages and exact push/CI commit ranges.
  `npm ci`, `npm run hooks` and the session-start hook configure the owner identity, unsigned
  commits and hooks. Attribution and session links are disabled in `.claude/settings.json`.
  `npm run validate` runs the existing offline gates in pre-push, CI and deployment;
  there is no fallback to HEAD when the comparison base cannot be read.
  Never reduce preview sizes or drop features to mask a performance regression; compare the
  previously working revision and measure the changed path first.

- The one AI note inkdex asks for: submission commits an agent helped with end with one trailer
  naming each tool and model, space-separated: `Assisted-by: ClaudeCode:<model> Codex:<model>`
  (niclim on #192). `scripts/pr-branch.sh` adds it. It goes on inkdex submission commits only,
  never on our own branches. Never merge `0.9/stable` into a submission branch; rebase.
- Work lands directly on `0.9/test` (and on `0.9/stable` for agent docs and tooling). Make no
  other branch unless asked: a branch is made only for an inkdex PR, when the person is ready.
- `0.9/test` is the working branch and what the repository page serves. `0.9/stable` mirrors
  inkdex's `0.9/stable` plus our README, theme, agent guides, skills, docs and scripts; update it
  from upstream only with `scripts/sync-upstream.sh`, which keeps those files.
- Do not open or comment on pull requests unless asked; draft the text for the person.

Shared guidance, attribution settings, hooks, validation scripts and their workflows must be
updated on both `0.9/test` and `0.9/stable`. Verify the published files on both branches and
report their commit ids. A history cleanup must preserve source trees and merge parents while
removing attribution trailers; verify the rewritten commit metadata before publishing it.

## 9. How a rule gets in

A review comment, a maintainer rewrite, or a device finding becomes a row in
`references/evidence.md` and a rule in `references/standards.md` in the same commit as the fix.
If it can be detected offline, add it to `scripts/check-sources.mjs` with a failing and a passing
test, then calibrate it over merged code
(`node scripts/check-sources.mjs --calibrate --root <inkdex clone>`). A rule that a recent
maintainer-approved source breaks is too broad: narrow it or make it a note. When evidence
contradicts a rule, fix the rule in the same commit and say where it was wrong.
