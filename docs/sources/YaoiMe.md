---
title: YaoiMe
type: subsystem
created: 2026-11-02
updated: 2026-11-07
sources:
  - code: src/YaoiMe/parsers.ts
  - code: src/YaoiMe/forms.ts
  - code: test/unit/YaoiMe.test.ts
  - ext: https://yaoi.me
verified_at: 9d2f1133
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
and omits empty strings, arrays and maps. Regression coverage checks that no unset value
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
