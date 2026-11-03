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

The persisted novel id remains `novel:<slug>`; comic ids remain plain slugs. Default chapter ids
remain the site's number or `oneshot`. The unified listing does not require a library migration.

Novel chapter lists use `items`, `total`, `limit` and `offset`; keep paging until the reported
total is collected. The reader supplies `body` text with inline HTML and `locked` / `lock_reason`;
serialize unlocked content as XHTML and retain the access error for a locked chapter. The public
Shadow Slave chapter 1 returned an unlocked body during verification; no captured text or
account data is stored here.

The body mixes newline-separated paragraphs with real `<i>`, `<b>` and other HTML emphasis,
so escaping the entire body renders the tags as literal text. Wrap the paragraphs, parse the
fragment through Cheerio and serialize with `xml: true`, preserving emphasis while escaping
text and closing void elements for Readium. Remove scripts, styles, iframes and forms. Verified
on 2026-11-03 against the site's rendered HTML and public API for This Game Is Too Realistic,
chapter id `1600` (site title Chapter 784.1): its final paragraph is italicized on the website.
The generated XHTML passed strict libxml2 validation; all 42 paragraph texts and four italic
elements matched the site's rendered article. Rendering in Paperback still needs a device check.

Trending periods are encoded in `sort` as `trending-day`, `trending-week` and
`trending-month`. Direct probes on 2026-11-03 returned different daily and monthly rankings;
`sort=trending&period=day` and `period=month` both returned the weekly order. Keep the mapping
in `buildSeriesUrl` when using the shared listing for novels.

## Scanlator versions

Comic chapter lists include each chapter's `scans`, with `slug`, `name` and `created_at`.
Expose these through Paperback's chapter `version` field. The `Automatic` version retains the
existing bare chapter id; an explicit choice uses `<number>@<encoded-scan-slug>`. Novels retain
their original chapter ids and do not gain scanlator versions. No per-chapter lookup is needed
to build the choices.

The reader accepts `/api/series/<slug>/chapters/<number>?scan=<slug>`. Decode the scan slug once
into the query, and preserve the full selected chapter id in the result. Refuse a response that
sets `scan_fallback` or returns another `scan`, so an explicit choice never silently opens a
different translation. Automatic reading keeps the site's default behavior.

Verified live on 2026-11-03 with Omniscient Reader chapter 1: `scan=asura` returned 14 pages,
while `scan=official` returned 167 pages; both reported the requested scan without fallback.

## Random and Complete & Bingeable

Both Discover carousels use the shared `/api/series` listing, include novels plus the selected
comic types, and retain content ratings and excluded genres/tags. Both also appear as search
sorts. `sort=bingeable` uses the site's ranking; it currently returns completed comics and no
novel results. An empty response ends paging normally.

`sort=random&seed=<integer>` repeats the same order across offsets. Generate a seed on the first
page and carry it in paging metadata, not instance state. A refresh starts a new seed. Live
probes verified that two three-item pages concatenate to the same six-item page, and another
seed changes the order. Each section page makes one request without per-card enrichment.

Section settings schema 3 adds the two sections once for existing installations, preserving
other hidden sections. Users can then hide or reorder them as usual; upgrading from schema 2
does not re-enable previously hidden novel sections.

## Regression coverage

`test/unit/Chikari.test.ts` covers mixed search ids and order, novel ranking chips, one-offset
paging, filtered novel home rows, shared taxonomy, the separate reader routes, chapter
pagination and locked/empty/XHTML reader handling, including nested bold/italic formatting,
entities and line breaks. It also checks scanlator ids, version labels,
dates, selected reader requests and fallback rejection; seeded Random search/Discover paging,
refresh, empty results, list filters and section visibility migration. `src/tests/Chikari.ts`
stays the generated SDK baseline; deeper Discover and novel coverage belongs in the unit suite
and live probes. Device chapter-version selection and carousel rendering remain unverified.
