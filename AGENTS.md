# Popmango Paperback 0.9 sources

Paperback **0.9** sources (`@paperback/types` and `@paperback/toolchain` `^1.0.0-alpha.92`),
developed on `0.9/test` and submitted one at a time to
[inkdex/general-extensions](https://github.com/inkdex/general-extensions), whose maintainers
review them. Write every source as if it were already that pull request. `CLAUDE.md` imports
this file; keep instructions here, not in two copies.

Load the **paperback-extension** skill (`.claude/skills/paperback-extension/`, also at
`.agents/skills/`) before touching a source. Its `references/standards.md` holds the merge rules
with the review comment or maintainer commit behind each one.

## Boundaries

- Keep the official toolchain and its output: `paperback-cli bundle`, `versioning.json`, the
  generated homepage with its `paperback://` links, `npm run serve`. Our homepage theme
  (`scripts/theme-homepage.mjs`) restyles that page; it does not replace it.
- This is the 0.9 `ExtensionImpl` API. 0.8 `Source`/`APIWrapper` code, the `compat/0.8` shim,
  and other readers' APIs (Aidoku, Mana, Mihon) are references for behaviour, never code to
  copy.
- A site on a generic theme (Madara, MangaStream/MangaReader, …) belongs in that theme's inkdex
  repository. `KingOfShojo` and `RokariComics` are MangaStream sites kept here pending that
  decision; do not copy their vendored base.
- Keep a fix inside its source. `src/utils/` is only for code several sources share.
- Do not rename a source directory or change saved manga or chapter ids without a migration
  decision. Never commit cookies, tokens, captured account data, `bundles/` or `node_modules/`.
- `scripts/`, `.github/`, `.husky/`, `package.json` and the lockfile change only when that work
  was asked for.

## Layout

| Path                                  | Holds                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/<Name>/`                         | one source: `main.ts`, `models.ts`, `network.ts`, `parsers.ts`, `forms.ts`, `utils.ts`, `pbconfig.ts`, `static/icon.png` |
| `src/tests/<Name>.ts`                 | the generated baseline test, unchanged                                                                                   |
| `scripts/`                            | repository checks and tools (Node, no dependencies); their tests in `scripts/tests/`                                     |
| `handoff/`                            | briefs for sources that belong in a theme repository                                                                     |
| `.claude/skills/paperback-extension/` | the workflow skill and its references                                                                                    |

## Rules that fail review most often

Full list, with evidence, in `references/standards.md`.

- Verify the live contract first: endpoints, field paths, pagination signal, real chapter ids,
  filter values in the site's casing. A reference client is not the schema.
- Follow the newest merged example of each feature: `node scripts/upstream-usage.mjs <Name>`.
- `main.ts` is the class only; constants in `models.ts`, defined once; every request in
  `network.ts` through `Application.scheduleRequest`.
- One request per Discover section; never a detail request per card. Pagination from the API's
  own signal.
- No wrappers, single-use constants, dead code, `any`, `console`, decorative or narrating
  comments, or catches that hide failures. Cloudflare is detected once, in `interceptResponse`.
- Every exposed filter is wired; tags round-trip into search; ids are sanitised with the
  canonical `SAFE_ID_REGEX` and self-sufficient.
- `src/tests/<Name>.ts` is exactly the generated baseline. Every change bumps
  `1.0.0-alpha.N`. The README lists the source.

## Commands

Use Node 24 (CI does; `PATH=/opt/node24/bin:$PATH` in the cloud sandbox) and `npm ci`.

```sh
npm run conformance                       # tsc, oxlint --deny-warnings, oxfmt --check (also the pre-push hook)
npm run check -- --base origin/0.9/test   # source rules on changed sources, including the version bump
npm run test:scripts                      # tests for scripts/
npm test -- <Name> && node scripts/check-tests.mjs <Name>   # live default tests; the CLI alone exits 0 on failure
scripts/review-source.sh <Name>           # all of the above for one source, plus the checklist; records a review stamp
node scripts/upstream-usage.mjs <Name>    # how merged inkdex sources implement what this source does
npm run dev                               # serve to a phone on the same network
scripts/pr-branch.sh <Name> -m "<subject>" --assisted-by <Agent:model>   # build the inkdex submission branch
scripts/sync-upstream.sh                  # merge new inkdex 0.9/stable commits into our 0.9/stable
```

Format one source with `npx oxfmt src/<Name>`; `npm run format` touches every file. oxfmt also
formats Markdown, so run it on edited docs. Never Prettier.

## Done means verified

Before calling a source change done: `scripts/review-source.sh <Name>` passes, and
`references/review.md` has been read against the diff. Report offline gates, live tests from
this machine, and device results separately, with the source version, title and chapter
exercised. A blocked site or an unreachable device is unverified, never a pass; say what would
settle it. In Claude Code the Stop hook enforces the review stamp.

## Versions, commits and branches

- Every push that changes a source bumps its `version` (`1.0.0-alpha.N` → `alpha.N+1`). A new
  source starts at `1.0.0-alpha.1`.
- Commits here are authored and committed by
  `Popmango Extensions <297959108+PoppingMangoSources@users.noreply.github.com>`, unsigned,
  `type(Scope): summary` with the source as scope, and a one- or two-sentence body. No issue
  numbers or links in messages. Do not name third parties in code or docs.
- Submission commits to inkdex additionally carry `Assisted-by: <Agent>:<model>` when AI
  assisted, as its PR template requires; `scripts/pr-branch.sh` adds it.
- `0.9/test` is the working branch and what the repository page serves. `0.9/stable` mirrors
  inkdex's `0.9/stable` plus our README and theme; update it only with `scripts/sync-upstream.sh`.
- Do not open or comment on pull requests unless asked; draft the text for the person.
