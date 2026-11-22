---
title: ReiManga
type: subsystem
created: 2026-11-12
updated: 2026-11-22
sources:
  - code: src/ReiManga/
  - ext: https://reimanga.net
verified_at: 2026-11-22
---

## Reader contract

Verified against live reader routes and the site's reader client on 2026-11-12.
`/manga/<slug>-<mangaId>/<chapterId>` serves Next.js Flight data, either directly
with `rsc: 1` or escaped inside HTML. Both representations now contain empty
`images[].image_url` values for packed chapters. Filtering those values produced
the reported "No pages found" error despite a complete reader manifest.

The sibling `pack.index` has version `v: 1`, segment page counts in `s`, and
page tuples `[byteLength, width, height]` in `p`. `pack.urls` contains the segment
URLs. Page offsets accumulate within each segment and reset for the next one.
The site requests byte ranges and checks each page's RIFF/WEBP signature and
declared length. It also accepts a complete HTTP 200 pack when a server ignores
Range. The source follows those rules without fetching packs while building the
chapter's page list.

Page URLs carry their range in a fragment, providing a distinct cache key for
each page. The interceptor sends the Range header and returns only that WebP.
This follows the fragment metadata approach used by merged MangaPlus and our
Toonkotsu. Direct image URLs remain supported. Saved manga and chapter IDs are
unchanged.

## Verification and limits

Live chapter payloads parsed successfully:

| Title                        | Chapter ID | Pages |
| ---------------------------- | ---------- | ----- |
| Accidental baby              | 100111267  | 55    |
| Accidental baby              | 2950051    | 7     |
| Hotaru no Yomeiri            | 1986227    | 67    |
| Cherry Blossoms After Winter | 3165285    | 23    |
| Wild Beast Warning           | 2905818    | 91    |

The previously reported Accidental baby chapter `2588304` was absent from the
current chapter list; its reader route returned a soft 404 rather than pages.
Do not replace it with an unrelated chapter or change saved IDs.

The CDN returned HTTP 403 for direct image-pack requests from this environment,
including requests with the site's Referer, Origin and Range headers. This is
not proof of image delivery. The site's fallback image API and token endpoint
also returned `third_party_unsupported`; no fallback URL or token is fabricated.
The website displayed individual images in a browser, but that does not verify
Paperback's native reader. Native image loading remains unverified.

Offline regression tests cover segment offsets, direct and fragmented readers,
invalid manifests, stable IDs, exact HTTP 206 ranges, HTTP 200 extraction,
corrupt WebP responses and Cloudflare propagation. They use independently
encoded WebP fixtures, not live tokens or account data.

## November 22 reader handoff

The current live chapter route no longer contains the packed manifest. It
returns `chapter`, `readerNonce`, and `handoffLevel: "members"`. The site's
current client mints an anonymous public-chapter ticket through POST
`/api/reader/ticket`, sending numeric `chapterId`, numeric `mangaId`, `nonce`, and
`src: "reader"`. The response hands the reader to `https://inkonthemap.org/r?d=…`.
The source validates that destination before requesting its HTML. This HTML
contains the image-pack manifest previously found on ReiManga itself, so the
existing parser and native byte-range interceptor can handle it. No WebView,
account token, or per-page ticket request is needed for the verified page lists.

Handoff chapter and manga IDs must match the requested saved IDs. External page
fragments also identify the reader origin, allowing per-request Referer/Origin
headers without mutable chapter state. Legacy ReiManga page fragments retain
their original headers. Comparable patterns are merged inkdex Mangago's
reader-specific headers, MangaPlus's image fragments, and our Toonkotsu's
fragment-driven interceptor.

Live source calls resolved these page lists through the complete GET chapter,
POST ticket, GET external reader sequence:

| Title                                                               | Chapter | Chapter ID | Pack pages |
| ------------------------------------------------------------------- | ------- | ---------- | ---------- |
| Awakening the Purple Thunder at the Beginning                       | 101     | 100148875  | 76         |
| The Exiled Reincarnated Heavy Knight Is Unrivaled in Game Knowledge | 0       | 3214333    | 36         |

The reported chapter 101 also displayed images in the public website reader in
Chrome. Its client used 11 individual `img.reimanga.net/drive-storage/…` images
rather than the 76 pack slices. This confirms website delivery, not native pack
delivery. Direct pack downloads from this test server returned HTTP 403 even
with the external reader's headers. The website's guarded fallback image API is
not implemented by this change. Paperback device image loading remains
unverified; do not report the page-list checks or browser rendering as a native
reader pass. No tickets or nonces are stored in source or documentation.

Offline tests additionally cover escaped handoffs, exact JSON ticket bodies,
wrong IDs, missing nonces, unexpected ticket destinations, external page
headers, legacy page headers, and retry after a propagated Cloudflare error.

## Discover presentation

Top Rated uses `Ch. N • ★ rating`, without a ranking number. Latest Updates keeps
its simple carousel with chapter number and relative timestamp. The live
`/api/manga/latest-updates` response provides `chapter_number`, `chapter_title`,
`rating`, and `release_date`, but no chapter ID. The website’s MangaCard also links
to the series, not a chapter. The owner chose to keep this row rather than add a
chapter-list request for every card or fabricate chapter IDs for the native updates
carousel. No Discover enrichment requests are added.
