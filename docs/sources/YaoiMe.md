---
title: YaoiMe
type: subsystem
created: 2026-11-02
updated: 2026-11-09
sources:
  - code: src/YaoiMe/parsers.ts
  - code: src/YaoiMe/forms.ts
  - code: test/unit/YaoiMe.test.ts
  - ext: https://yaoi.me
verified_at: pending
---

# YaoiMe

## Coverless cards

A native device report on 2026-11-04 rejected the entire Latest section because one card's
`imageUrl` was empty. The same day's live home page contained a coverless Where Love Goes
card: the website renders an inline text/SVG placeholder rather than an image. Cover parsing
now uses the site's verified `/apple-icon.png` fallback whenever no cover is supplied, both
in lists and details. The PNG returned HTTP 200. This preserves the title without another
request per card. A 31-card regression fixture covers a missing cover at index 28 and checks
every output URL and chapter-zero subtitle.

## Advanced search metadata

Unset fields previously returned `undefined` values. The form now builds sparse metadata
and omits unset values and empty strings. Explicit empty language, type and rating selections
remain in metadata so they override saved defaults. Regression coverage checks that no unset value
crosses the native bridge. The original device risk recorded in this page is resolved in code;
submitting the form and rendering the revised feed still require device verification.

## Presentation

Listings use chapter plus type when known, with rating as fallback, and never exceed two
subtitle facts. Cover URLs and chapter numbers are derived from the existing page response.

The live Latest check returned 36 valid image URLs, including the site-icon fallback. The
baseline browse request returned HTTP 403 on this machine, leaving its dependent details,
chapters and reader tests unverified. This does not establish a reader failure in the app.

## Webtoon flag, 2026-11-07

`MangaInfo.isWebtoon` (types alpha.93) comes from the type shown in the series header: true for manhwa, manhua and webtoon,
false otherwise, so the reader scrolls those vertically. Nothing extra is fetched for it.

## Filters and retries, 2026-11-09

The live `/browse` Flight payload supplies 38 genres, 1,372 tags, seven types, six statuses,
four content ratings, four demographics and 41 languages. Advanced search reads these facets
from one session-memoized request, following merged FlameComics' option mapping and HiveToons'
promise pattern. Settings retain the known language/type/rating choices; Doujinshi is now
included in the type defaults. Genre and tag ids use the same percent encoding as details.
Tags use a native tri-state list rather than comma-separated fields.

The live browse client writes `langs`, not `lang`. Status uses `releasing` (displayed as
Ongoing), `unknown` and `upcoming`; demographics use the site's capitalized values. Two filtered
requests returned HTTP 403 here, so corrected result membership still needs a device check.
Request routing and inclusion/exclusion parameters are covered offline. Clearing a per-search
language/type/rating selection sends no constraint instead of restoring the setting.

A rejected taxonomy or shared home request clears its memo and propagates the original error,
allowing the next attempt to retry. Concurrent taxonomy requests still share one promise;
Cloudflare completion and settings changes reset both memos. No TTL or persisted taxonomy is
introduced.

## Chapters and links, 2026-11-09

The site's `numReal: 0` marks internal counters for notices, not chapter numbers. Null numbers
are retained too. These entries now use unknown chapter number `-1`, preserve their labels and
receive a sorting index from the site's anchored group order. Numbered chapters retain their
real numbers, including zero and decimals, and `vol` is kept when supplied. Native ordering of
unnumbered entries remains unverified on this machine.

Deduplicate Chapters defaults off. When enabled, it keeps the first site-ranked variant per
group and language, preserving separate specials, parts and volumes. The captured Passion list
has 1,395 English uploads, or 176 entries with deduplication, including all seven unnumbered
notices/specials in both modes. Chapter ids remain `/chapter/<s>/<id>`.

Alternative titles come from the JSON-LD array as well as the header. Passion now retains all
eight aliases. Pasted series links accept numeric paths, trailing slashes and query/fragment
suffixes; pasted chapter links resolve the series link on that page. Canonical series ids are
returned for pasted links, while existing saved ids remain unchanged. Failed link requests
propagate rather than falling through into a title search.

## Discover lists, 2026-11-09

Binge, Trending, Top Rated, Bookmarked, Hidden Gems, Most Talked About and Rising now fetch their
own `/discover/<section>` listing, following merged MangaFire's parameterized section handler.
Each live listing returned 60 cards, compared with 16 in the corresponding home preview. Both
`/discover/trending` and `?page=2` returned the same list with no next-page link, so no extra pages
are invented. Paging metadata is emitted only if the document supplies a next-page link.
Popular Updates and Latest Releases keep the shared home response because the site provides no
full listing link for those rows. A refresh now costs seven ranking requests plus one shared
home request and a session-memoized taxonomy request, with no per-title requests.

## Verification for alpha.11

All offline repository gates and eight YaoiMe regression tests passed. The generated live suite
passed initialise and sorting; filtered browse returned HTTP 403, blocking the dependent details,
chapter-list and reader checks. Direct public-page checks independently verified the taxonomy,
all seven ranking lists and Passion's aliases/chapter variants. Name chapter 5461557's reader
manifest also decrypted to 35 pages using the current script key. This is not a device pass: the
tri-state list, clearing selections, View More and unnumbered chapter ordering need iPhone testing.
