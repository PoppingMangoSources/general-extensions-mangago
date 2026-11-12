---
title: RokariComics
type: subsystem
created: 2026-11-12
updated: 2026-11-12
sources:
  - code: src/RokariComics/
  - code: test/unit/RokariComics.test.ts
  - ext: https://rokaricomics.com
verified_at: pending
---

## Reader request cost

The legacy Paperback reader stores the chapter's `data-num` value as its ID.
It previously reloaded the entire series page on every chapter opening, found
the matching row, and only then requested its reader URL.

On 2026-11-12 the site's homepage and The Golden-Handed Baby Fixes Everything
chapter list linked integer chapters as `/<series-slug>-chapter-<number>/`.
The source now opens that route directly while preserving existing numeric
chapter IDs. Post-ID mode reuses the existing saved post-ID-to-slug mapping.
When no mapping exists, or a chapter ID is not an integer, the original link
lookup remains in use. Locked IDs still fail before a reader request.

The live before/after comparison of chapter 2 returned the same 16 image URLs:
two requests before, one after. Individual timing samples had different cache
states and are not a controlled latency benchmark. Offline tests cover both
ID modes, the missing-mapping lookup and locked chapter visibility.

The page parser also preserves existing percent escapes. Previously its
`encodeURI` call changed an image path containing `%20` into `%2520` and could
alter encoded signature query values. This is covered by an offline URL
regression, independently of the live request-count comparison.

Mana already stores the chapter's actual path and opens it in one request.
Its reported-title probe passed 18 checks, including sampled image downloads;
no source rewrite was needed there. Device rendering remains unverified.
