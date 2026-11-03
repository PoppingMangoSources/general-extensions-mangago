---
title: XCOMIC
type: subsystem
created: 2026-11-03
updated: 2026-11-03
sources:
  - code: src/XCOMIC/models.ts
  - code: src/XCOMIC/network.ts
  - code: src/XCOMIC/main.ts
  - code: src/XCOMIC/parsers.ts
  - code: test/unit/XCOMIC.test.ts
  - ext: https://github.com/Aidoku-Community/sources/tree/main/sources/multi.xcomic
  - ext: https://github.com/keiyoushi/extensions-source/tree/main/src/all/xcomic
  - ext: https://github.com/PoppingMangoSources/popmango-extensions-mana/tree/main/src/XCOMIC
verified_at: pending
---

# XCOMIC

## Editions and chapter uploads are separate choices

Compared the current Aidoku Community, Keiyoushi and Mana implementations on 2026-11-03.
Their useful shared behaviors are edition/team preservation, the server's unique/full chapter
lists, correct chapter languages and complete pagination. Keiyoushi uses title-based library
keys; Paperback's existing edition keys must remain unchanged.

`Merge editions` defaults off. With it off, refreshing chapters makes only the opened
edition's chapter-list requests. With it on, `get_comicNode.data.title_titleNode.comicNodes`
supplies sibling editions. Keep the opened edition first, even after the language preference
changes. Add public, normal, nonempty siblings in the selected languages; request at most
three edition lists concurrently. Search returns one representative edition per title while
merging, and chapter lists name each team's version under the original saved manga id.

`Deduplicate chapters` defaults on. It selects `get_comic_chapterList_uniqList` with
`Select_Comic_ChapterList_UniqList`, page size 1000. Turning it off selects
`get_comic_chapterList_fullList` with `Select_Comic_ChapterList`, page size 600. Both responses
are aliased to `chapterList` and expose `paging.pages`, `paging.total` and `paging.next`.

Live queries for The Greatest Estate Developer edition `vg7ypp` returned 172 unique entries
and 182 full entries on 2026-11-03. Complete each edition's pagination, then check the raw
entry count against its total before filtering non-normal uploads. Fail an incomplete list
instead of publishing it as a complete refresh.

## Merged duplicate policy

Each chapter keeps its existing URL-path id. The reader resolves the global chapter id from
that path, so chapters from sibling editions need no change to the saved manga id. Retain
team version, translated language, volume and date; interleave editions by chapter number and
date.

With deduplication on, repeated editions of the same named team share one version label,
case-insensitively. For the same language, volume and chapter number, keep entries from the
first edition that supplies them. Preserve multiple parts within that edition, unnumbered
extras and other teams' translations. With deduplication off, retain every distinct upload.
Do not deduplicate across all teams by chapter number.
An importer such as `srcName=mpark` is not proof of a shared scanlator: unnamed editions keep
their entries even when that importer label matches.

## Further parity work

Edition inclusion/exclusion and grouping controls from Mana could be added separately. The
Aidoku/Mana title-level author, artist and description fallbacks are also worth considering
when a comic edition lacks metadata; request those fields in the same GraphQL response.
Do not copy reader-specific caches, title-key migrations or unsupported reading-direction
fields into Paperback.

## Verification

Unit coverage checks defaults, both endpoint modes, page completion, public/language edition
selection, stable reader ids and team/language/volume/extra preservation. The generated live
SDK baseline stays unchanged. Device settings persistence, grouping and layout need a phone
check.

Live testing passed the six SDK defaults, unique/full switching and merged edition reading.
The merged Asura Scans chapter `/chapter/jkrgp5` returned 40 images under the saved `vg7ypp`
manga id. Unit coverage additionally ensures unnamed editions sharing an importer are kept.
