---
title: Source checks
type: operation
created: 2026-11-02
updated: 2026-11-02
sources:
  - code: scripts/check-sources.mjs
  - code: scripts/tests/check-sources.test.mjs
verified_at: pending
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

## Presentation and cover URLs, 2026-11-04

`empty-image-url` rejects literal empty `imageUrl`/`thumbnailUrl` properties. Computed values
still need runtime coverage: YaoiMe's live coverless card reproduced a whole-row native crash.
`test/unit/Listings.test.ts` checks the shared two-fact subtitle contract, chapter zero,
latest-versus-total labels and compact metrics. Per-source regression tests verify the mappers
actually use that contract. The new formatters make no additional network requests.

Calibration found no empty-image literal findings across 22 merged reference sources.
Submission packaging includes the shared listing formatter when the submitted source imports
it, so the source remains buildable when copied out of the working branch.
