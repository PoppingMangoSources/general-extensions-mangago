---
title: Chikari
type: subsystem
created: 2026-11-03
updated: 2026-11-03
sources:
  - code: src/Chikari/services/network.ts
  - code: src/Chikari/main.ts
  - code: src/Chikari/implementations/search-results-providing/main.ts
  - code: src/Chikari/implementations/shared/parsers.ts
  - code: src/Chikari/implementations/chapter-providing/parsers.ts
  - code: test/unit/Chikari.test.ts
  - ext: https://chikari.moe/
verified_at: pending
---

# Chikari

## Shared listings, separate readers

Verified against public responses on 2026-11-03 and the supplied site captures:

- `/api/series?type=novel` lists novels. Mixed types share this endpoint, one ordering and one
  offset. Preserve the returned `medium` when assigning source ids.
- `/api/home?type=novel` serves novel home rows. Send content ratings and genre/tag exclusions
  here as for comics; the old `/api/novels/home` returns 404.
- `/api/genres?novels=true` and `/api/tags?novels=true` include the novel taxonomy. The old
  `/api/novels/genres` and `/api/novels/tags` return 404. Each option list needs one fetch.
- `/api/novels/<slug>`, `/api/novels/<slug>/chapters` and
  `/api/novels/<slug>/chapters/<number>/read` remain the novel detail, chapter and reader
  routes. Do not replace these with `/api/series`: `shadow-slave` exists as both a comic
  and a novel, with different chapter lists.

The persisted novel id remains `novel:<slug>`; comic ids remain plain slugs. Chapter ids remain
the site's number or `oneshot`. The unified listing does not require a library migration.

Novel chapter lists use `items`, `total`, `limit` and `offset`; keep paging until the reported
total is collected. The reader supplies plain `body` text and `locked` / `lock_reason`; render
unlocked text as escaped XHTML, and retain the access error for a locked chapter. The public
Shadow Slave chapter 1 returned an unlocked body during verification; no captured text or
account data is stored here.

Trending periods are encoded in `sort` as `trending-day`, `trending-week` and
`trending-month`. Direct probes on 2026-11-03 returned different daily and monthly rankings;
`sort=trending&period=day` and `period=month` both returned the weekly order. Keep the mapping
in `buildSeriesUrl` when using the shared listing for novels.

## Regression coverage

`test/unit/Chikari.test.ts` covers mixed search ids and order, novel ranking chips, one-offset
paging, filtered novel home rows, shared taxonomy, the separate reader routes, chapter
pagination and locked/empty/XHTML reader handling. `src/tests/Chikari.ts` stays the generated
SDK baseline; deeper Discover and novel coverage belongs in the unit suite and live probes.

## Possible later additions

The captured comic chapter response exposes `scans` and accepts `?scan=<slug>`. This could
support an explicit scanlator choice while preserving existing default chapter ids. The public
homepage also links to `sort=bingeable` (Complete & Bingeable); that sort currently returns no
novel results. Search additionally offers `sort=random` with a seed for repeatable paging.
None is added by the novel API repair; they need separate source changes and releases.
