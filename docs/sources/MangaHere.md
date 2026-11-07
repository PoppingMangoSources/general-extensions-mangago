---
title: MangaHere
type: subsystem
created: 2026-11-07
updated: 2026-11-07
sources:
  - code: src/MangaHere/
  - code: test/unit/MangaHere.test.ts
  - ext: https://www.mangahere.cc
  - ext: https://m.mangahere.cc
verified_at: pending
---

# MangaHere

## Reader

The mobile reader at `https://m.mangahere.cc/roll_manga/<mangaId>/<chapterId>/1.html`
returns every chapter image in `#viewer img`. Prefer `data-original` over the loading GIF
in `src`, preserve document order and deduplicate repeated image URLs. Chapter IDs retain
their optional volume prefix, such as `v20/c187`, and fractional chapter numbers.

Kitty's MangaFox uses the equivalent roll reader on `m.fanfox.net`. On 2026-11-07 the MangaHere
route returned 16 pages for Tsugumomo chapter 187, 16 for chapter 188.2, and 53 for One Piece
chapter 1. `newm.mangahere.cc` serves a different reader that still loads images through
scripts. Use `m.mangahere.cc` for the roll reader.

The desktop reader requires a key script and one `chapterfun.ashx` request per page.
It still parsed a live Tsugumomo chapter during this review, so the screenshot's exact
`eval(script).toString` error was not reproduced here. The roll reader supplies its complete
page list in one document. Some mobile titles, including Onepunch-Man chapter 240, return a
licensed/unavailable notice while the desktop reader supplies chapter images. Fall back to
the existing desktop reader when the mobile reader is missing or fails, and propagate
verification challenges immediately. The generated live test now uses the first search result
instead of the previous seeded Tsugumomo title, which exposed this difference.
All six generated live tests passed with the mobile reader and desktop fallback.

## HTTPS and transport failures

Live catalogue covers use HTTP URLs on `fmcdn.mangahere.com`. The same signed cover URL and
the roll reader's first `zjcdn.mangahere.org` page returned HTTP 200 with image content over
HTTPS. Normalize explicit HTTP and protocol-relative image URLs to HTTPS, preserving their
query strings. The screenshot's App Transport Security error does not identify the failing
URL; the HTTP covers are a confirmed source of insecure image requests.
The request interceptor also upgrades HTTP URLs that came from older cached title or reader data.

Transport retries wait with `Application.sleep(seconds)`. The old `setTimeout` backoff works
in Node but fails in Paperback's device runtime. Verification errors propagate immediately.
Tests cover one-request reading, HTTPS URLs, loading placeholders, retry delays, and challenge
propagation. Completing browser verification and rendering pages still need a device check.
