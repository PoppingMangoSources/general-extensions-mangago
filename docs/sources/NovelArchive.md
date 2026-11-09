---
title: NovelArchive
type: subsystem
created: 2026-11-09
updated: 2026-11-09
sources:
  - code: src/NovelArchive/
  - code: test/unit/NovelArchive.test.ts
  - ext: https://novelarchive.st
  - ext: https://github.com/inkdex/general-extensions/pull/257
verified_at: pending
---

# NovelArchive

Live API and client JavaScript inspected on 2026-11-09. Working baseline:
`origin/0.9/test` at `2732acbe52939cf37bbfaa89d9ba5acf5247c121`; PR baseline:
`92f8e116aec75fd1dc412c22a77a25fef8b1e927`; merged inkdex reference:
`ecaf3fb814010b8523cb1b015cdb40652433f9b9`.

## Live contract

| Feature           | Contract                                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain            | `.cc` redirects to `.st`; accept pasted novel/reader URLs on either domain.                                                                                                                   |
| Browse and search | `GET /api/novels`, `page`, `per_page=30`, `search`, `fuzzy=1`; use `pagination.has_next` before local filtering.                                                                              |
| Sort              | `recent`, `popular`, `rating`, `chapters`.                                                                                                                                                    |
| Status            | `all`, `ongoing`, `completed`, `hiatus`.                                                                                                                                                      |
| Genres            | `/api/novels/genres`; lower-case `value`, display `label`; comma-separated `genres_include` and `genres_exclude`; `genre_match=any` means OR, omitted means AND.                              |
| Feeds             | `/api/novels/trending?limit=50`, `/api/novels/recently-updated?limit=50`, `/api/novels/editors-choice?limit=50`; feeds are unpaged, while Top Rated and Recently Added use the library endpoint.                                                                         |
| Details           | `/api/novels/<id>`; aliases in `associated_names`, five-point `rating`, comma-separated `genres`.                                                                                             |
| Native chapters   | `chapter_names` in detail payload; endpoint IDs are **1-based positions**, independent of printed numbering. The site's `novel-page.js` falls back to `total_chapters` when names are absent. |
| Mirror chapters   | `/api/novels/<id>/sources`, then `/sources/<source>/chapters`; each entry supplies `number` and `title`.                                                                                      |
| Native reader     | `/api/novels/<id>/chapters/<position>?prefetch=1`, text in `chapter.content`; prefetch avoids resending the full novel chapter-name array.                                                    |
| Mirror reader     | `/api/novels/<id>/sources/<source>/chapters/<number>`, HTML in `content_html`.                                                                                                                |

Keep manga IDs and native chapter IDs unchanged. Mirror IDs remain `<source>:<number>`.
The array position is the native API's actual addressing contract, so the general prohibition
on inventing positional chapter IDs does not apply here.

## Verified traps and fixes

- **Latest-release labels and native reader IDs are distinct.** Listing responses usually omit
  `chapter_names` but supply `latest_release`. Parse an explicit `Chapter N` or `Ch. N` into
  `Ch. N` on cards, preferring it to the total. If it says `Unknown` or `9 hours ago`, keep
  `N Chs` rather than invent a chapter number. These site-supplied release labels can be stale:
  Two Worlds returned `total_chapters: "3"` and `latest_release: "Chapter 134 ..."`; native
  chapter 3 returned HTTP 200 but chapter 134 returned 404. The Extra's Odyssey had
  `total_chapters: "226"` and stale `latest_release: "Chapter 3 ..."`. Keep update links
  addressed by native 1-based position, never by the displayed release number. No per-card
  detail requests.
- **Unequal versions must sort by chapter number.** Sorting each source's local index interleaves
  native `[1, 2]` and mirror `[100, 101]` as `[1, 100, 2, 101]`. Sort the combined chapters by
  `chapNum`, retaining IDs and version labels.
- **Genre ID encoding must round-trip punctuation.** Live genres include `bl (boys' love)` and
  `r*pe`. `encodeURIComponent` leaves apostrophes and asterisks unchanged; replacing them with
  hyphens silently changes the API filter. Percent-encode those characters instead. Existing
  novel and chapter identifiers in sampled responses are unchanged.
- **Defaults are fallbacks.** Explicit search genres replace the stored defaults; an explicit
  empty object clears them. Apply visibility settings to every Discover feed and URL search.
  Filter metadata uses no undefined-valued entries, and local filtering does not change paging.
- **The genre-match control already works.** SDK alpha.94 `SelectSection` mutates its supplied
  array in place. No extra callback is needed. A test invokes the real SDK-generated selector.
- **A failed taxonomy request must retry.** Use one session memo, clear it on rejection and
  Cloudflare bypass; do not read a second persisted taxonomy cache.
- **Do not discard late mirrors.** Removed the eight-second race and broad failure-to-empty
  catches. Failed source requests now remain visible instead of silently losing versions.
- **Mirror illustrations need absolute URLs.** Ghost Story mirror chapter 1 returns a root-relative
  `/api/novels/.../img/...jpg`. Resolve relative image URLs before XML serialization; preserve
  existing absolute and inline image schemes and allow image-only chapters.
- **Mojibake repair is necessary.** The same live mirror contains UTF-8 decoded as Latin-1.
  Preserve genuine Unicode and invalid Latin-1 runs; do not delete this utility as unused.
- **HTTP 200 can contain an upstream challenge.** LOTM native chapter 1438 contains the novel title,
  a chapter heading, then `Security Check Required` and `Please complete the security check`.
  Reject this known placeholder with a useful message; it is not a Paperback Cloudflare response.
- **Empty markup is empty content.** Reject blank mirror paragraphs before opening the reader;
  normalize void elements and entities to XML-valid namespaced XHTML.
- **Computed cover URLs need validation.** Omit individual blank-title or invalid-cover listing
  records before they cross the native bridge. Details report invalid covers as an error.

## Upstream comparison and review coverage

Used the current canonical file layout and free functions. `main.ts` owns orchestration,
`models.ts` shared data, `network.ts` requests/interceptor, `parsers.ts` mapping,
`forms/` settings/search, and `utils.ts` the nontrivial encoding repair. Consolidated the
listing parser and section mapping; removed the extra dispatch, feed and item wrappers.
`fetchJSON` follows the merged vocabulary and retains contextual JSON errors with their cause.
The owner prefers `parseNovelList` and `filterNovelList` for this novels-only catalog.
SDK method names and types retain Paperback's manga terminology. Parsers and network helpers
are arrow functions; the extension, interceptor and native form classes are framework-required.

Compared merged HiveToons for generic listing mapping, filtering, forms and memo loading;
FlameComics for request helpers and class removal; MangaFire for shared section behavior;
RoyalRoad, LNori and Atsumaru for novel readers. Older merged examples do not override
current platform or maintainer guidance. Kept the update pre-check because merged MangaDot
uses the same Cloudflare probe; it is not dead code just because it does not mark updates.

Read all five requested behavioral references: Aidoku Community, Suwatte, NovelSourcery,
LNReader and Mana Books. Their API paths corroborate investigation; live responses and the
site's current `api.js`, `libary-page.js`, `index-home.js`, `novel-page.js` and reader client
establish the contract. LNReader's ten-point rating assumption is outdated. Current client
code uses five points. Do not add old AI/view filters without a current working contract.

Checked every recorded review-evidence row against the source and retrieved all 352 public
inline review comments then available in inkdex/general-extensions. Additional relevant
niclimcy comments reinforce application scheduling and preserving error causes:
[#287 scheduling](https://github.com/inkdex/general-extensions/pull/287#discussion_r4260317012),
[#287 minimal movement](https://github.com/inkdex/general-extensions/pull/287#discussion_r4260328013),
[#224 error causes](https://github.com/inkdex/general-extensions/pull/224#discussion_r3448444972).
No reviewer login containing `kantan` or matching entry in the attached/current evidence was
found; no review is attributed to that name without evidence. PR #257 currently has owner
comments but no maintainer inline review findings.

The attached guidance snapshots were compared with current `0.9/test` instructions,
skill references, docs, source checks, review/submission scripts, validation entry point,
workflow gates and generated baseline test. Relevant enforcement runs through `validate`.
No dependency, workflow or shared-tooling changes are required by this source change.
The old review script contains a HEAD comparison fallback; its requested comparison ref
was explicitly verified before invoking it, so the fallback was not used.

## Verification

Source version `1.0.0-alpha.61`, Node `24.22.1`, Paperback types/toolchain `1.0.0-alpha.94`.
Offline regression coverage includes exact subtitles, chapter zero/decimals, safe IDs,
mirror ordering, genre reset/AND/OR, shared visibility, memo retry, error propagation,
blank readers, relative illustrations and known upstream security content.
The generated `src/tests/NovelArchive.ts` remains unchanged.

Live default tests passed all six checks. An additional source-method harness using the
same installed runtime polyfills exercised 33 requests: all six Discover sections,
all four sorts, text search/page two, all three non-default statuses, genre include/exclude
with AND/OR, both pasted URL domains, details/aliases/chapters and native/mirror chapter 1
for LOTM (`69faadd3a5f4c7d1b734d49f`) and Ghost Story (`6a162ec14f942c668d69a598`).
Combined chapter lists contained 2,871 and 1,629 entries respectively and were monotonic.
Generated native and mirror XHTML was independently XML-parsed with lxml/libxml2.

No device was available. Discover rendering, settings persistence, Swift bridge behavior,
chapter version grouping, in-app image loading and actual Cloudflare bypass remain
unverified on a device. Sampled responses expose no paid/locked flags; no speculative
access fields were added. Missing-name fallback is verified against the site's own client
and offline fixtures; sampled live detail payloads contained names.

Opera was disconnected during the prior audit. Browser Use subsequently verified the public
Trending, Editor's Choice and Recently Updated APIs, 30-item library paging and the inconsistent
Two Worlds chapter IDs on 2026-11-09. Firecrawl and direct HTTP/API checks also supplied earlier
live evidence. No user accounts or private data were used.
