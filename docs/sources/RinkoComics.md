---
title: RinkoComics
type: subsystem
created: 2026-11-12
updated: 2026-11-12
sources:
  - code: src/RinkoComics/
  - code: test/unit/RinkoComics.test.ts
  - ext: https://rinkocomics.com
verified_at: pending
---

## Canvas reader

On 2026-11-12, The Golden-Handed Baby Fixes Everything chapter 2 returned
22 `canvas.chapter-image` elements and no `img.chapter-image` elements. The
previous parser reported this free chapter as locked or unavailable.

The site's inline reader decodes `#cwPages` as base64, uses the first 16 bytes
as a repeating XOR mask, and parses the remaining decoded UTF-8 bytes as a JSON
array of image URLs. The source follows that contract without executing the
site's scripts. Image readers using `img.chapter-image` and novel prose remain
supported. Malformed payloads and empty readers report a reader error rather
than assuming a paid lock.

Both Paperback and Mana parsed the live payload into the same 22 ordered URLs.
The first and last images were fetched independently. Mana's complete probe for
this title/chapter passed 14 checks, including sampled image downloads.
Paperback's generated baseline selected a newer paid chapter and correctly
refused it; that baseline is not an end-to-end pass for the free reader.
No device reader test was available.

The current Keiyoushi RinkoComics reader also only selects `img.chapter-image`;
it does not establish support for the new canvas payload.
