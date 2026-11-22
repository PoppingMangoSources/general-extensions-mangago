---
title: RinkoComics
type: subsystem
created: 2026-11-12
updated: 2026-11-21
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

## November 21 redesign

Live home and browse responses now use `data-cw-slider`/`data-slide`,
`section[aria-labelledby="cw-week-m"]`, `section[aria-labelledby="cw-novels"]`,
`#cw-latest article`, and `#cwBrowse ul > li`. Home rows follow the requested
Editor’s Choice, Featured This Week, Latest Releases (Comics), New Novels,
Latest Releases (Novels), Genres order. The featured shelf does not provide
chapter numbers; none are invented. Hero synopsis and genres need no detail requests.

Comics Today is `/?show=today`. Novel updates use the All tab at `/?rel=novels`,
which currently supplies 24 series; the owner switched this from Today because
Today can be empty. Both comic tabs currently return the same 24 series, including
older chapter stamps; the source requests Today and preserves the response.
Editor’s Choice shows its first three genres through the native `tag.fill` info item,
matching MangaTown, with no duplicate genre supertitle or per-title requests.
Readable updates choose the first unlocked chapter. Date strings are now short
forms such as `2h`, and chapter-list dates append a view count after `·`.

Browse uses `q`, `sort` (`updated`, `new`, `views`, `az`) and `genres[]`.
The new chapter list is `#cwChapters a.chapter-item`; older AJAX chapter rows
remain supported. Saved comic, novel and chapter paths are unchanged.
Novel prose is now `#cwNovelText`, serialized to XML-valid XHTML.

Live verification: 8 hero cards, 4 featured titles, 6 new novels and 24 readable
comic updates. The Princess Maid chapter 62 decoded to 18 page URLs. The
Youngest Daughter of the Snake Family chapter 1 supplied prose. The default
runner's newest chapter is paid and correctly refused; it is not a full pass.
Device layout and rendering remain unverified.
