---
title: ReiManga
type: subsystem
created: 2026-11-12
updated: 2026-11-12
sources:
  - code: src/ReiManga/
  - ext: https://reimanga.net
verified_at: pending
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
