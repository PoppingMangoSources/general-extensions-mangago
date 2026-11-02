---
name: paperback-extension
description: Create, fix, port, review or submit a Paperback 0.9 source (extension) in this repository so it meets inkdex/general-extensions merge standards. Use when adding a manga, comic or novel site as a source, changing or porting an existing one, reviewing a source diff, answering inkdex review comments, preparing an inkdex pull request, or syncing with upstream.
---

# Paperback 0.9 sources for inkdex

A source is a class implementing `ExtensionImpl<typeof Config>` from `@paperback/types`,
exported from `main.ts` and declared in `pbconfig.ts`. Sources here are meant to merge into
`inkdex/general-extensions`, so they are written to its maintainers' standards from the start.
`AGENTS.md` holds the boundaries and commands; this skill is the order of work.

| Read                       | When                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| `references/standards.md`  | always, before writing code: the merge rules with their evidence         |
| `references/recon.md`      | before writing a selector, field name or filter value                    |
| `references/sdk.md`        | for any `@paperback/types` shape, capability, form or toolchain question |
| `references/review.md`     | before calling work done                                                 |
| `references/testing.md`    | before claiming anything works                                           |
| `references/submission.md` | when a source goes to inkdex, or a review comes back                     |
| `references/evidence.md`   | when a rule seems wrong, or a new review comment arrives                 |

## 1. Place it

A site on a generic theme (Madara, MangaStream/MangaReader, …) belongs in that theme's inkdex
repository, not here. If upstream already has the source, start from upstream's copy:
`git diff upstream/0.9/stable HEAD -- src/<Name>` and keep the maintainer's changes.

## 2. Recon

Confirm against live responses, per `recon.md`: each endpoint, field path or selector, the
pagination signal, the real chapter id, access flags, and every filter value's exact casing. A
reference implementation tells you endpoints, not the schema. When the sandbox cannot reach the
site, say which facts are unconfirmed rather than copying them.

## 3. Find the merged pattern

```sh
node scripts/upstream-usage.mjs <Name>              # who upstream does what this source does
node scripts/upstream-usage.mjs --feature '<regex>' # who upstream does what you are about to add
```

Read the newest example of each feature (recent maintainer rewrites come first) and match its
shape: file placement, naming, fetch helper, memo promise, form wiring. Diverge only for a
reason the site forces, and say it in the PR.

## 4. Build

Order that avoids rework: `models.ts` → `network.ts` → `parsers.ts` → `main.ts` → `forms` →
`pbconfig.ts`, then `npx paperback-cli test --generate <Name>` for a new source. Port every
capability the site or the reference has: sections, filters with exclusions, sorts, settings.
Keep each rule in `standards.md`; the ones marked **[check]** fail the gate.

## 5. Verify

```sh
PATH=/opt/node24/bin:$PATH scripts/review-source.sh <Name>
```

Types, lint, format, the source rules against `origin/0.9/test` (including the version bump),
the merged-pattern report, live tests read from their report, and the checklist from
`review.md` to read against the diff. It records a stamp; the Claude Code Stop hook will not
let a turn end while a changed source fails its rules or lacks a passing review of its current
files. A failure that is the site or the network is reported as unverified, never as a pass.

## 6. Ship

Commit on `0.9/test` as Popmango Extensions with a bumped version. For inkdex, build the branch
with `scripts/pr-branch.sh` (`submission.md`) and draft the PR text for the person to post.
