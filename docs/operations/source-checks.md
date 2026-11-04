---
title: Source checks
type: operation
created: 2026-11-02
updated: 2026-11-02
sources:
  - code: scripts/check-sources.mjs
  - code: scripts/tests/check-sources.test.mjs
  - code: scripts/check-commits.mjs
  - code: scripts/validate.mjs
  - code: scripts/tests/enforcement.test.mjs
  - code: .claude/settings.json
  - code: .github/workflows/source-checks.yaml
  - code: .github/workflows/bundle-deploy.yaml
verified_at: f3d531a1a9d8483bba921f2d32fd4b6cec1f2f88
---

# Source checks

`scripts/check-sources.mjs` checks the rules that need no network. FAIL rules come from inkdex
review comments, policy, SDK deprecations or device crashes; NOTE rules are ones merged code
disagrees on. Each rule has a failing and a passing test.

## Calibration (2026-11-02)

Run over inkdex `0.9/stable` (22 sources): no FAIL rule added this round fires on merged code. Old
FAILs fire only in older or specialised sources (MangaFox, MangaKatana, MangaDex, Mangapill's
header, non-square icons in Atsumaru and Roliascan). Notes kept as notes because maintainers merge
them: `SelectRow` `options` (11 sources), emoji (6), `setTimeout` (Mangago, MangaDex),
`function` declarations (Mangago, AllManga).

`metadata: undefined` ending paging appears in 20 merged sources, so only `undefined` values
inside a `Metadata` object fail.

## Our backlog (fails on the source when it is next changed)

- Generated test file replaced by custom cases: BunManga, Chikari, Cocomic, LikeManga, LuaComic,
  MangaHere, MangaHome (no test file at all), MVLEMPYR, Ranobes, RinkoComics, RokariComics,
  StoneScape, VyManga.
- README does not list: LuaComic, ScansGG, TempleScan. `name` with spaces: LuaComic, TempleScan.
- Cocomic: missing license header. KingOfShojo: empty catch. YaoiMe: `metadata-undefined`.

## Repository and commit gates

`npm run validate -- --base origin/0.9/test` runs the commit check, conformance, agent-doc
sync, script tests, changed-source checks and tests, then the bundle and layout checks. The
pre-push hook and both checking and publishing workflows use this entry point. Tooling-only
changes still run the repository checks. Live-site and device checks remain separate.

`npm run hooks` installs the local hooks and configures the owner's identity with signing
disabled. Claude's SessionStart hook does the same; its shared settings disable commit and PR
attribution and session URLs. The commit-message hook checks pending messages, and the push
and CI checks examine raw metadata across the actual update range, including merge parents
and commits already on the remote. The upstream submission branch exception for `Assisted-by`
is retained; the test branch allows no attribution trailers. See the root guide for the
canonical policy and allowed owner identity.

An unexpected Stop-hook execution error blocks completion. Regression tests exercise a real
installed commit hook, an invalid merged commit and broken hook input, alongside the settings
and workflow wiring.

The pinned actionlint release has stale input metadata for `actions/create-github-app-token@v3`.
Its official action definition accepts `client-id`; `.github/actionlint.yaml` suppresses only
the two resulting input diagnostics in `registry-management.yaml`. Other diagnostics still
fail workflow validation.

## Presentation and cover URLs, 2026-11-04

`empty-image-url` rejects literal empty `imageUrl`/`thumbnailUrl` properties. Computed values
still need runtime coverage: YaoiMe's live coverless card reproduced a whole-row native crash.
`test/unit/Listings.test.ts` checks the shared two-fact subtitle contract, chapter zero,
latest-versus-total labels and compact metrics. Per-source regression tests verify the mappers
actually use that contract. The new formatters make no additional network requests.

Calibration found no empty-image literal findings across 22 merged reference sources.
Submission packaging includes the shared listing formatter when the submitted source imports
it, so the source remains buildable when copied out of the working branch.

## Branch parity and historical attribution, 2026-11-04

Shared guidance and enforcement belong on both branches. Attribution settings alone do not
rewrite older messages: the stable sync commit retained a co-author/session footer despite
later owner-only commits. Historical cleanup recreates that merge and its descendants with
unchanged trees and the same upstream parent, then advances the branch with an expected-head
lease. Imported upstream commits retain their original authors.

Stable now carries the working branch's session setup, commit-msg/pre-push hooks, owner-only
commit checks, shared validation and publication workflows. Future upstream syncs preserve
`.github` as well as guides, skills, hooks and scripts, and restore our npm commands even when
upstream defines commands with the same names. Regression coverage exercises that merge path.
